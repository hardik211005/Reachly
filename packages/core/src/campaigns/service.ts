import type { Prisma } from "@repo/db";
import { audit } from "../audit";
import { assertFeature, resolvePlan } from "../billing/plans";
import { assertCan, type TenantContext } from "../context";
import { FeatureNotInPlanError, NotFoundError, PreconditionError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { campaignInputSchema, defaultSequence, DEFAULT_DAILY_LIMITS, type CampaignInput } from "./schemas";

/** Validates the campaign configuration against the plan (automation modes & channels). */
async function assertPlanAllows(ctx: TenantContext, data: { automationMode: string; channels: string[] }) {
  const plan = await resolvePlan(ctx);
  if (!plan.features.automationModes.includes(data.automationMode as never)) {
    throw new FeatureNotInPlanError(`${data.automationMode.toLowerCase()} automation`, plan.name);
  }
  const blocked = data.channels.filter((channel) => !plan.features.channels.includes(channel as never));
  if (blocked.length) throw new FeatureNotInPlanError(`${blocked.join(", ").toLowerCase()} outreach`, plan.name);
  if (data.channels.includes("VOICE")) await assertFeature(ctx, "voiceAgent");
}

export async function createCampaign(ctx: TenantContext, input: CampaignInput) {
  assertCan(ctx, "campaigns:write");
  const data = campaignInputSchema.parse(input);
  await assertPlanAllows(ctx, data);

  if (data.offeringIds.length) {
    const count = await ctx.db.offering.count({ where: { id: { in: data.offeringIds }, deletedAt: null } });
    if (count !== data.offeringIds.length) throw new ValidationError("One or more offerings do not exist");
  }

  const steps = data.steps ?? defaultSequence(data.channels);
  const limits = Object.fromEntries(data.channels.map((channel) => [channel, data.dailyLimits[channel] ?? DEFAULT_DAILY_LIMITS[channel]]));

  const campaign = await ctx.db.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        organizationId: ctx.organizationId,
        name: data.name,
        description: data.description,
        status: "DRAFT",
        automationMode: data.automationMode,
        target: data.target as Prisma.InputJsonValue,
        offeringIds: data.offeringIds,
        offerSummary: data.offerSummary,
        pitchAngle: data.pitchAngle,
        tone: data.tone,
        channels: data.channels,
        dailyLimits: limits,
        minLeadScore: data.minLeadScore,
        createdById: ctx.userId,
      },
    });
    await tx.campaignStep.createMany({
      data: steps.map((step, order) => ({
        campaignId: created.id,
        order,
        channel: step.channel,
        delayDays: step.delayDays,
        condition: step.condition ?? "NO_REPLY",
        name: step.name,
        subject: step.subject ?? null,
        body: step.body,
        useAI: step.useAI ?? true,
        whatsappTemplateId: step.whatsappTemplateId ?? null,
      })),
    });
    return created;
  });

  await recordEvent(ctx, { type: "campaign_created", campaignId: campaign.id, properties: { name: campaign.name, mode: campaign.automationMode } });
  await audit(ctx, { action: "campaign.created", resourceType: "campaign", resourceId: campaign.id });
  return campaign;
}

export async function getCampaign(ctx: TenantContext, id: string) {
  assertCan(ctx, "campaigns:read");
  const campaign = await ctx.db.campaign.findFirst({
    where: { id, deletedAt: null },
    include: { steps: { orderBy: { order: "asc" }, include: { whatsappTemplate: { select: { id: true, name: true, status: true, body: true, language: true } } } } },
  });
  if (!campaign) throw new NotFoundError("Campaign", id);
  return campaign;
}

export async function listCampaigns(ctx: TenantContext, options: { status?: string[] } = {}) {
  assertCan(ctx, "campaigns:read");
  return ctx.db.campaign.findMany({
    where: { deletedAt: null, ...(options.status?.length ? { status: { in: options.status as never[] } } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateCampaignDraft(ctx: TenantContext, id: string, input: CampaignInput) {
  assertCan(ctx, "campaigns:write");
  const existing = await ctx.db.campaign.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError("Campaign", id);
  if (existing.status !== "DRAFT" && existing.status !== "PAUSED") {
    throw new PreconditionError("Pause the campaign before editing it");
  }
  const data = campaignInputSchema.parse(input);
  await assertPlanAllows(ctx, data);
  const limits = Object.fromEntries(data.channels.map((channel) => [channel, data.dailyLimits[channel] ?? DEFAULT_DAILY_LIMITS[channel]]));

  await ctx.db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        automationMode: data.automationMode,
        target: data.target as Prisma.InputJsonValue,
        offeringIds: data.offeringIds,
        offerSummary: data.offerSummary,
        pitchAngle: data.pitchAngle,
        tone: data.tone,
        channels: data.channels,
        dailyLimits: limits,
        minLeadScore: data.minLeadScore,
      },
    });
    if (data.steps) {
      await tx.campaignStep.deleteMany({ where: { campaignId: id } });
      await tx.campaignStep.createMany({
        data: data.steps.map((step, order) => ({
          campaignId: id,
          order,
          channel: step.channel,
          delayDays: step.delayDays,
          condition: step.condition,
          name: step.name,
          subject: step.subject,
          body: step.body,
          useAI: step.useAI,
          whatsappTemplateId: step.whatsappTemplateId,
        })),
      });
    }
  });
  await audit(ctx, { action: "campaign.updated", resourceType: "campaign", resourceId: id });
  return getCampaign(ctx, id);
}
