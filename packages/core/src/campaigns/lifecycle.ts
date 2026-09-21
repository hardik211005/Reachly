import { AI_CREDITS_PER_MESSAGE_ESTIMATE, AVERAGE_CALL_MINUTES_ESTIMATE, CHANNEL_UNIT_COST_USD, type Channel } from "@repo/config";
import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { audit } from "../audit";
import { assertResourceLimit, resolvePlan } from "../billing/plans";
import { getUsage } from "../billing/usage";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError, ProviderNotConfiguredError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { primaryContact } from "../outreach/context";
import { channelAvailability } from "../outreach/providers";

export interface LaunchEstimate {
  audience: number;
  eligible: Partial<Record<Channel, number>>;
  blocked: Array<{ reason: string; count: number }>;
  steps: Array<{ order: number; channel: Channel; name: string; delayDays: number; useAI: boolean }>;
  messages: Partial<Record<Channel, number>>;
  aiCredits: number;
  estimatedCostUsd: { ai: number; email: number; whatsapp: number; voice: number; total: number };
  usage: Array<{ metric: string; needed: number; remaining: number | null; ok: boolean }>;
  providers: Record<string, { ok: boolean; provider?: string; simulated?: boolean }>;
  warnings: string[];
  canLaunch: boolean;
}

/** Everything a user should know before automated outreach starts. */
export async function estimateLaunch(ctx: TenantContext, campaignId: string): Promise<LaunchEstimate> {
  assertCan(ctx, "campaigns:read");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null }, include: { steps: { orderBy: { order: "asc" }, include: { whatsappTemplate: true } } } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);

  const members = await ctx.db.campaignLead.findMany({
    where: { campaignId, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } },
    include: { lead: { include: { contacts: { where: { deletedAt: null } } } } },
  });
  const [compliance, availability, usage, suppressions] = await Promise.all([
    ctx.db.complianceSettings.findFirst(),
    channelAvailability(ctx),
    getUsage(ctx),
    ctx.db.suppression.findMany({ where: { OR: [{ scope: "GLOBAL" }, { campaignId }] }, select: { type: true, value: true } }),
  ]);
  const suppressed = new Set(suppressions.map((row) => `${row.type}:${row.value}`));

  const eligible: Partial<Record<Channel, number>> = {};
  const blocked = new Map<string, number>();
  const bump = (reason: string) => blocked.set(reason, (blocked.get(reason) ?? 0) + 1);

  for (const member of members) {
    const { lead } = member;
    if (lead.doNotContact || suppressed.has(`LEAD:${lead.id}`)) {
      bump("Do not contact");
      continue;
    }
    for (const channel of campaign.channels) {
      if (channel === "EMAIL") {
        const email = primaryContact(lead.contacts, "EMAIL")?.email ?? lead.email;
        if (!email) bump("No email address");
        else if (suppressed.has(`EMAIL:${email}`)) bump("Email suppressed");
        else eligible.EMAIL = (eligible.EMAIL ?? 0) + 1;
      } else if (channel === "WHATSAPP") {
        const contact = primaryContact(lead.contacts, "WHATSAPP");
        if (!contact && !lead.phone) bump("No WhatsApp number");
        else if ((compliance?.whatsappRequireOptIn ?? true) && !contact?.whatsappOptIn) bump("No WhatsApp opt-in");
        else eligible.WHATSAPP = (eligible.WHATSAPP ?? 0) + 1;
      } else {
        if (!lead.phone && !lead.contacts.some((c) => c.phone)) bump("No phone number");
        else eligible[channel] = (eligible[channel] ?? 0) + 1;
      }
    }
  }

  const messages: Partial<Record<Channel, number>> = {};
  let aiCredits = 0;
  for (const step of campaign.steps) {
    const count = eligible[step.channel] ?? 0;
    messages[step.channel] = (messages[step.channel] ?? 0) + count;
    if (step.useAI && (step.channel === "EMAIL" || step.channel === "WHATSAPP")) aiCredits += count * AI_CREDITS_PER_MESSAGE_ESTIMATE;
    if (step.channel === "VOICE") aiCredits += count * AI_CREDITS_PER_MESSAGE_ESTIMATE * 2;
  }
  const voiceMinutes = Math.ceil((messages.VOICE ?? 0) * AVERAGE_CALL_MINUTES_ESTIMATE);
  const cost = {
    ai: Math.round(aiCredits * 0.001 * 100) / 100,
    email: Math.round((messages.EMAIL ?? 0) * CHANNEL_UNIT_COST_USD.EMAIL * 100) / 100,
    whatsapp: Math.round((messages.WHATSAPP ?? 0) * CHANNEL_UNIT_COST_USD.WHATSAPP * 100) / 100,
    voice: Math.round(voiceMinutes * CHANNEL_UNIT_COST_USD.VOICE_PER_MINUTE * 100) / 100,
    total: 0,
  };
  cost.total = Math.round((cost.ai + cost.email + cost.whatsapp + cost.voice) * 100) / 100;

  const metricNeeds: Array<[string, number]> = [
    ["AI_CREDITS", aiCredits],
    ["EMAIL_SENDS", messages.EMAIL ?? 0],
    ["WHATSAPP_MESSAGES", messages.WHATSAPP ?? 0],
    ["VOICE_MINUTES", voiceMinutes],
  ];
  const usageChecks = metricNeeds
    .filter(([, needed]) => needed > 0)
    .map(([metric, needed]) => {
      const snapshot = usage.metrics.find((item) => item.metric === metric);
      const remaining = snapshot?.remaining ?? null;
      return { metric: snapshot?.label ?? metric, needed, remaining, ok: remaining === null || remaining >= needed };
    });

  const providers: LaunchEstimate["providers"] = {};
  const warnings: string[] = [];
  for (const channel of campaign.channels) {
    if (channel === "EMAIL" || channel === "WHATSAPP") {
      providers[channel] = availability[channel];
      if (!availability[channel].ok) warnings.push(`No ${channel === "EMAIL" ? "email" : "WhatsApp"} provider is connected.`);
      else if (availability[channel].simulated) warnings.push(`${channel === "EMAIL" ? "Email" : "WhatsApp"} uses the demo provider — messages are simulated, not delivered.`);
    }
  }
  if (campaign.channels.includes("WHATSAPP") && campaign.steps.some((step) => step.channel === "WHATSAPP" && step.whatsappTemplate?.status !== "APPROVED")) {
    warnings.push("Some WhatsApp steps have no approved template; they will only send inside a 24-hour reply window.");
  }
  if (!members.length) warnings.push("The audience is empty — add leads before launching.");
  for (const check of usageChecks) if (!check.ok) warnings.push(`Not enough ${check.metric.toLowerCase()} remaining (${check.remaining} of ${check.needed} needed). Outreach will pause when they run out.`);

  const hardBlock = !members.length || campaign.channels.some((channel) => (channel === "EMAIL" || channel === "WHATSAPP") && !availability[channel].ok);
  return {
    audience: members.length,
    eligible,
    blocked: [...blocked.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    steps: campaign.steps.map((step) => ({ order: step.order, channel: step.channel, name: step.name, delayDays: step.delayDays, useAI: step.useAI })),
    messages,
    aiCredits,
    estimatedCostUsd: cost,
    usage: usageChecks,
    providers,
    warnings,
    canLaunch: !hardBlock && ["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status),
  };
}

export async function launchCampaign(ctx: TenantContext, campaignId: string, input: { confirm: boolean }) {
  assertCan(ctx, "campaigns:launch");
  if (!input.confirm) throw new ValidationError("Explicit confirmation is required to launch a campaign");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) throw new PreconditionError(`A ${campaign.status.toLowerCase()} campaign can't be launched`);

  const plan = await resolvePlan(ctx);
  if (!plan.features.automationModes.includes(campaign.automationMode)) throw new PreconditionError(`${campaign.automationMode} mode isn't available on the ${plan.name} plan`);
  await assertResourceLimit(ctx, "activeCampaigns", await ctx.db.campaign.count({ where: { status: "ACTIVE", deletedAt: null } }));

  const estimate = await estimateLaunch(ctx, campaignId);
  for (const channel of campaign.channels) {
    if ((channel === "EMAIL" || channel === "WHATSAPP") && !estimate.providers[channel]?.ok) throw new ProviderNotConfiguredError(channel === "EMAIL" ? "email" : "WhatsApp");
  }
  if (!estimate.audience) throw new PreconditionError("Add leads to the campaign before launching");

  const now = new Date();
  await ctx.db.campaign.update({
    where: { id: campaignId },
    data: { status: "ACTIVE", launchedAt: now, launchedById: ctx.userId, pausedAt: null, launchEstimate: estimate as unknown as Prisma.InputJsonValue },
  });
  // Stagger first touches a few seconds apart so providers see a natural sending pattern.
  const pending = await ctx.db.campaignLead.findMany({ where: { campaignId, status: "PENDING" }, select: { id: true }, orderBy: { addedAt: "asc" } });
  for (const [index, row] of pending.entries()) {
    await ctx.db.campaignLead.update({ where: { id: row.id }, data: { status: "IN_SEQUENCE", nextStepOrder: 0, nextActionAt: new Date(now.getTime() + index * 4_000) } });
  }
  await recordEvent(ctx, { type: "campaign_started", campaignId, properties: { audience: estimate.audience, mode: campaign.automationMode, channels: campaign.channels } });
  await audit(ctx, { action: "campaign.launched", resourceType: "campaign", resourceId: campaignId, metadata: { estimate: { audience: estimate.audience, messages: estimate.messages, costUsd: estimate.estimatedCostUsd.total } } });
  await getQueue().enqueue("sequences.tick", {}, { jobId: `tick:launch:${campaignId}` });
  return { status: "ACTIVE" as const, estimate };
}

export async function pauseCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:launch");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status !== "ACTIVE") throw new PreconditionError("Only active campaigns can be paused");
  await ctx.db.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED", pausedAt: new Date() } });
  await recordEvent(ctx, { type: "campaign_paused", campaignId });
  await audit(ctx, { action: "campaign.paused", resourceType: "campaign", resourceId: campaignId });
}

export async function resumeCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:launch");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status !== "PAUSED") throw new PreconditionError("Only paused campaigns can be resumed");
  await ctx.db.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE", pausedAt: null } });
  // Messages approved while paused go out now; due sequence steps resume on the next tick.
  const approved = await ctx.db.message.findMany({ where: { campaignId, status: { in: ["APPROVED", "QUEUED"] } }, select: { id: true } });
  for (const message of approved) {
    await getQueue().enqueue("messages.send", { organizationId: ctx.organizationId, messageId: message.id }, { jobId: `send:${message.id}:resume:${Date.now()}` });
  }
  await ctx.db.campaignLead.updateMany({ where: { campaignId, status: "IN_SEQUENCE", nextActionAt: null }, data: { nextActionAt: new Date() } });
  await recordEvent(ctx, { type: "campaign_resumed", campaignId });
  await getQueue().enqueue("sequences.tick", {}, { jobId: `tick:resume:${campaignId}:${Date.now()}` });
}

export async function completeCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:launch");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (!["ACTIVE", "PAUSED"].includes(campaign.status)) throw new PreconditionError("Only running campaigns can be completed");
  await ctx.db.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await ctx.db.campaignLead.updateMany({ where: { campaignId, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } }, data: { status: "COMPLETED", nextActionAt: null, stoppedReason: "Campaign completed" } });
  await ctx.db.message.updateMany({ where: { campaignId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } }, data: { status: "CANCELED", error: "Campaign completed" } });
  await recordEvent(ctx, { type: "campaign_completed", campaignId });
}

export async function archiveCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:write");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status === "ACTIVE") throw new PreconditionError("Pause or complete the campaign first");
  await ctx.db.campaign.update({ where: { id: campaignId }, data: { status: "ARCHIVED" } });
}

export async function duplicateCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:write");
  const source = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null }, include: { steps: true } });
  if (!source) throw new NotFoundError("Campaign", campaignId);
  const copy = await ctx.db.campaign.create({
    data: {
      organizationId: ctx.organizationId,
      name: `${source.name} (copy)`,
      description: source.description,
      status: "DRAFT",
      automationMode: source.automationMode,
      target: source.target as Prisma.InputJsonValue,
      offeringIds: source.offeringIds,
      offerSummary: source.offerSummary,
      pitchAngle: source.pitchAngle,
      tone: source.tone,
      channels: source.channels,
      dailyLimits: source.dailyLimits as Prisma.InputJsonValue,
      minLeadScore: source.minLeadScore,
      createdById: ctx.userId,
    },
  });
  await ctx.db.campaignStep.createMany({
    data: source.steps.map((step) => ({
      campaignId: copy.id,
      order: step.order,
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
  await recordEvent(ctx, { type: "campaign_created", campaignId: copy.id, properties: { name: copy.name, duplicatedFrom: campaignId } });
  return copy;
}

export async function deleteCampaign(ctx: TenantContext, campaignId: string) {
  assertCan(ctx, "campaigns:write");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status === "ACTIVE") throw new PreconditionError("Pause or complete the campaign before deleting it");
  await ctx.db.campaign.update({ where: { id: campaignId }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "campaign.deleted", resourceType: "campaign", resourceId: campaignId });
}
