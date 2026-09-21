import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { z } from "zod";
import { isSuppressed } from "../compliance/suppression";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";
import { leadListQuerySchema, type LeadListQueryInput } from "../leads/schemas";
import { whereFromQuery } from "../leads/service";

const MAX_AUDIENCE_BATCH = 1000;

/** Campaign memberships that still have steps to run in a live (or about-to-launch) campaign. */
const ACTIVE_ELSEWHERE = {
  status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] },
  campaign: { status: { in: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"] }, deletedAt: null },
} satisfies Prisma.CampaignLeadWhereInput;

/** Leads the builder can target: not already running in another campaign. */
function availableLeadsWhere(where: Prisma.LeadWhereInput): Prisma.LeadWhereInput {
  return { AND: [where, { campaignLeads: { none: ACTIVE_ELSEWHERE } }] };
}

/**
 * Adds leads to a campaign audience. Do-not-contact / suppressed leads are skipped (and
 * reported), duplicates are ignored. If the campaign is already running, new members are
 * scheduled for the sequence immediately.
 */
export async function addLeadsToCampaign(ctx: TenantContext, campaignId: string, leadIds: string[]) {
  assertCan(ctx, "campaigns:write");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status === "COMPLETED" || campaign.status === "ARCHIVED") throw new PreconditionError("This campaign has ended");

  const leads = await ctx.db.lead.findMany({
    where: { id: { in: leadIds }, deletedAt: null },
    select: { id: true, email: true, phone: true, doNotContact: true, primaryCampaignId: true },
  });
  const existing = new Set(
    (await ctx.db.campaignLead.findMany({ where: { campaignId, leadId: { in: leadIds } }, select: { leadId: true } })).map((row) => row.leadId),
  );
  // One live sequence per lead: nobody gets two openers from two campaigns at once.
  const busy = new Set(
    (
      await ctx.db.campaignLead.findMany({
        where: { leadId: { in: leadIds }, campaignId: { not: campaignId }, ...ACTIVE_ELSEWHERE },
        select: { leadId: true },
      })
    ).map((row) => row.leadId),
  );

  const skipped: Array<{ leadId: string; reason: string }> = [];
  const toAdd: string[] = [];
  for (const lead of leads) {
    if (existing.has(lead.id)) {
      skipped.push({ leadId: lead.id, reason: "already in campaign" });
      continue;
    }
    if (busy.has(lead.id)) {
      skipped.push({ leadId: lead.id, reason: "active in another campaign" });
      continue;
    }
    if (lead.doNotContact) {
      skipped.push({ leadId: lead.id, reason: "do not contact" });
      continue;
    }
    const channel = campaign.channels[0] ?? "EMAIL";
    const suppression = await isSuppressed(ctx, { leadId: lead.id, email: lead.email, phone: lead.phone }, { channel, campaignId });
    if (suppression.suppressed) {
      skipped.push({ leadId: lead.id, reason: `suppressed (${suppression.reason.toLowerCase()})` });
      continue;
    }
    toAdd.push(lead.id);
  }

  const running = campaign.status === "ACTIVE";
  if (toAdd.length) {
    await ctx.db.campaignLead.createMany({
      data: toAdd.map((leadId) => ({
        organizationId: ctx.organizationId,
        campaignId,
        leadId,
        status: running ? "IN_SEQUENCE" : "PENDING",
        nextStepOrder: 0,
        nextActionAt: running ? new Date() : null,
      })),
      skipDuplicates: true,
    });
    await ctx.db.lead.updateMany({ where: { id: { in: toAdd }, primaryCampaignId: null }, data: { primaryCampaignId: campaignId } });
    for (const leadId of toAdd) {
      await recordEvent(ctx, { type: "lead_added_to_campaign", leadId, campaignId, properties: { campaign: campaign.name } });
    }
    if (running) await getQueue().enqueue("sequences.tick", {}, { jobId: `tick:${campaignId}:${Date.now()}` });
  }
  return { added: toAdd.length, skipped, notFound: leadIds.length - leads.length };
}

export async function removeLeadFromCampaign(ctx: TenantContext, campaignId: string, leadId: string) {
  assertCan(ctx, "campaigns:write");
  const row = await ctx.db.campaignLead.findFirst({ where: { campaignId, leadId } });
  if (!row) throw new NotFoundError("Campaign lead");
  await ctx.db.campaignLead.update({ where: { id: row.id }, data: { status: "STOPPED", stoppedReason: "Removed by user", nextActionAt: null } });
  await ctx.db.message.updateMany({
    where: { leadId, campaignId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } },
    data: { status: "CANCELED", error: "Removed from campaign" },
  });
}

/** Adds every lead matching lead-table filters (capped) — used by the campaign builder. */
export async function addLeadsByFilter(ctx: TenantContext, campaignId: string, filters: LeadListQueryInput) {
  assertCan(ctx, "campaigns:write");
  const query = leadListQuerySchema.parse({ ...filters, page: 1, pageSize: 200 });
  const rows = await ctx.db.lead.findMany({ where: availableLeadsWhere(whereFromQuery(query)), select: { id: true }, orderBy: { score: { sort: "desc", nulls: "last" } }, take: MAX_AUDIENCE_BATCH });
  if (!rows.length) return { added: 0, skipped: [], notFound: 0 };
  return addLeadsToCampaign(ctx, campaignId, rows.map((row) => row.id));
}

/** How many leads a filter matches and how many are reachable per channel (builder preview). */
export async function previewAudience(ctx: TenantContext, filters: LeadListQueryInput) {
  assertCan(ctx, "leads:read");
  const query = leadListQuerySchema.parse({ ...filters, page: 1, pageSize: 200 });
  const where = availableLeadsWhere(whereFromQuery(query));
  const [total, withEmail, withPhone, sample] = await Promise.all([
    ctx.db.lead.count({ where }),
    ctx.db.lead.count({ where: { AND: [where, { OR: [{ email: { not: null } }, { contacts: { some: { email: { not: null }, deletedAt: null } } }] }] } }),
    ctx.db.lead.count({ where: { AND: [where, { OR: [{ phone: { not: null } }, { contacts: { some: { OR: [{ phone: { not: null } }, { whatsapp: { not: null } }], deletedAt: null } } }] }] } }),
    ctx.db.lead.findMany({ where, orderBy: { score: { sort: "desc", nulls: "last" } }, take: 6, select: { id: true, name: true, category: true, city: true, locality: true, score: true } }),
  ]);
  return { total: Math.min(total, MAX_AUDIENCE_BATCH), matched: total, withEmail, withPhone, sample, capped: total > MAX_AUDIENCE_BATCH };
}

export const campaignLeadsQuerySchema = z.object({
  status: z.enum(["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL", "REPLIED", "COMPLETED", "STOPPED", "OPTED_OUT", "FAILED"]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listCampaignLeads(ctx: TenantContext, campaignId: string, input: z.input<typeof campaignLeadsQuerySchema> = {}) {
  assertCan(ctx, "campaigns:read");
  const query = campaignLeadsQuerySchema.parse(input);
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null }, select: { id: true, steps: { select: { order: true, name: true, channel: true }, orderBy: { order: "asc" } } } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  const where = {
    campaignId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { lead: { name: { contains: query.q, mode: "insensitive" as const } } } : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.campaignLead.findMany({
      where,
      orderBy: [{ lastStepAt: { sort: "desc", nulls: "last" } }, { addedAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { lead: { select: { id: true, name: true, category: true, city: true, locality: true, score: true, status: true, email: true, phone: true } } },
    }),
    ctx.db.campaignLead.count({ where }),
  ]);
  return { items: items.map((item) => ({ ...item, nextStep: campaign.steps.find((step) => step.order === item.nextStepOrder) ?? null })), total, page: query.page, pageSize: query.pageSize, steps: campaign.steps };
}
