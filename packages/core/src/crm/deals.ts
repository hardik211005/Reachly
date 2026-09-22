import { DEAL_STAGE_LABELS, DEAL_STAGE_PROBABILITY, DEAL_STAGES, type DealStage, type LeadStatus } from "@repo/config";
import type { Deal, Event, Prisma } from "@repo/db";
import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { changeLeadStatus } from "../leads/service";
import { logger } from "../logger";

/**
 * Deals and the pipeline. A deal belongs to a lead (the company). Deal stages and lead
 * statuses stay in step in both directions, but only ever move forward automatically:
 * a reply never drags a deal in negotiation back to "Interested".
 */

export const OPEN_STAGES: readonly DealStage[] = ["NEW", "QUALIFIED", "CONTACTED", "INTERESTED", "MEETING", "PROPOSAL", "NEGOTIATION"];
const CLOSED_STAGES: readonly DealStage[] = ["WON", "LOST"];
const STAGE_RANK: Record<DealStage, number> = { NEW: 0, QUALIFIED: 1, CONTACTED: 2, INTERESTED: 3, MEETING: 4, PROPOSAL: 5, NEGOTIATION: 6, WON: 7, LOST: 7 };
const LEAD_RANK: Record<LeadStatus, number> = { NEW: 0, QUALIFIED: 1, CONTACTED: 2, REPLIED: 3, INTERESTED: 4, MEETING: 5, QUOTE_SENT: 6, WON: 7, LOST: 7, DO_NOT_CONTACT: 99 };

const STAGE_TO_LEAD: Record<DealStage, LeadStatus | null> = {
  NEW: null,
  QUALIFIED: "QUALIFIED",
  CONTACTED: "CONTACTED",
  INTERESTED: "INTERESTED",
  MEETING: "MEETING",
  PROPOSAL: "QUOTE_SENT",
  NEGOTIATION: "QUOTE_SENT",
  WON: "WON",
  LOST: "LOST",
};

/** Lead statuses that open (or advance) a deal automatically. Earlier statuses are too early for the pipeline. */
const LEAD_TO_STAGE: Partial<Record<LeadStatus, DealStage>> = { INTERESTED: "INTERESTED", MEETING: "MEETING", QUOTE_SENT: "PROPOSAL", WON: "WON", LOST: "LOST" };

const GAP = 1024;

export const dealInputSchema = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  value: z.number().nonnegative().max(100_000_000_000).default(0),
  stage: z.enum(DEAL_STAGES).default("NEW"),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
});
export type DealInput = z.input<typeof dealInputSchema>;

export const dealUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    value: z.number().nonnegative().max(100_000_000_000),
    probability: z.number().int().min(0).max(100).nullable(),
    expectedCloseDate: z.coerce.date().nullable(),
    ownerId: z.uuid().nullable(),
    contactId: z.uuid().nullable(),
  })
  .partial();

export const dealMoveSchema = z.object({
  stage: z.enum(DEAL_STAGES),
  /** The deal that should end up directly above / below this one in the column. */
  prevId: z.uuid().nullish(),
  nextId: z.uuid().nullish(),
  lostReason: z.string().trim().min(1).max(300).optional(),
  value: z.number().nonnegative().max(100_000_000_000).optional(),
});

export const pipelineQuerySchema = z.object({
  owner: z.enum(["me", "all"]).default("all"),
  q: z.string().trim().max(100).optional(),
});

export function dealProbability(deal: Pick<Deal, "probability" | "stage">): number {
  return deal.probability ?? DEAL_STAGE_PROBABILITY[deal.stage as DealStage];
}

// ----------------------------------------------------------------------------- Positions

async function positionIn(ctx: TenantContext, stage: DealStage, prevId?: string | null, nextId?: string | null): Promise<number> {
  const [prev, next] = await Promise.all([
    prevId ? ctx.db.deal.findFirst({ where: { id: prevId, stage, deletedAt: null }, select: { position: true } }) : null,
    nextId ? ctx.db.deal.findFirst({ where: { id: nextId, stage, deletedAt: null }, select: { position: true } }) : null,
  ]);
  if (prev && next) {
    const middle = (prev.position + next.position) / 2;
    if (Math.abs(next.position - prev.position) > 1e-6) return middle;
    // Positions ran out of precision: respace the column and retry once.
    const column = await ctx.db.deal.findMany({ where: { stage, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true } });
    await ctx.db.$transaction(column.map((deal, index) => ctx.db.deal.update({ where: { id: deal.id }, data: { position: (index + 1) * GAP } })));
    return positionIn(ctx, stage, prevId, nextId);
  }
  if (prev) return prev.position + GAP;
  if (next) return next.position - GAP;
  // Top of the column.
  const first = await ctx.db.deal.findFirst({ where: { stage, deletedAt: null }, orderBy: { position: "asc" }, select: { position: true } });
  return first ? first.position - GAP : GAP;
}

// ----------------------------------------------------------------------------- Lead status sync

/** Moves a lead's status forward to match its deal (or to won/lost, or reopened from them). */
async function syncLeadToStage(ctx: TenantContext, leadId: string, stage: DealStage, reason: string) {
  const target = STAGE_TO_LEAD[stage];
  if (!target) return;
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { status: true } });
  if (!lead || lead.status === "DO_NOT_CONTACT" || lead.status === target) return;
  const current = lead.status as LeadStatus;
  const reopening = (current === "WON" || current === "LOST") && !CLOSED_STAGES.includes(stage);
  if (LEAD_RANK[target] > LEAD_RANK[current] || CLOSED_STAGES.includes(stage) || reopening) {
    await changeLeadStatus(ctx, leadId, target, reason);
  }
}

// ----------------------------------------------------------------------------- Mutations

export async function createDeal(ctx: TenantContext, input: DealInput, options: { source?: string; campaignId?: string | null; sourceChannel?: Deal["sourceChannel"] } = {}) {
  assertCan(ctx, "crm:write");
  const data = dealInputSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, select: { id: true, name: true, ownerId: true, primaryCampaignId: true } });
  if (!lead) throw new NotFoundError("Lead", data.leadId);
  if (data.ownerId && !(await ctx.db.membership.findFirst({ where: { userId: data.ownerId } }))) throw new ValidationError("Owner must be a workspace member");
  if (data.contactId && !(await ctx.db.contact.findFirst({ where: { id: data.contactId, leadId: lead.id, deletedAt: null } }))) throw new ValidationError("Contact must belong to this lead");
  const now = new Date();
  const deal = await ctx.db.deal.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      contactId: data.contactId ?? null,
      campaignId: options.campaignId ?? lead.primaryCampaignId ?? null,
      title: data.title ?? lead.name,
      stage: data.stage,
      value: data.value,
      probability: data.probability ?? null,
      expectedCloseDate: data.expectedCloseDate ?? null,
      ownerId: data.ownerId ?? lead.ownerId ?? ctx.userId ?? null,
      sourceChannel: options.sourceChannel ?? null,
      position: await positionIn(ctx, data.stage),
      stageChangedAt: now,
      wonAt: data.stage === "WON" ? now : null,
      lostAt: data.stage === "LOST" ? now : null,
    },
  });
  await recordEvent(ctx, { type: "deal_created", leadId: lead.id, dealId: deal.id, campaignId: deal.campaignId, properties: { title: deal.title, stage: deal.stage, value: Number(deal.value), source: options.source ?? "manual" } });
  await syncLeadToStage(ctx, lead.id, deal.stage as DealStage, `Deal “${deal.title}”`);
  return deal;
}

export async function updateDeal(ctx: TenantContext, id: string, input: z.input<typeof dealUpdateSchema>) {
  assertCan(ctx, "crm:write");
  const data = dealUpdateSchema.parse(input);
  const deal = await ctx.db.deal.findFirst({ where: { id, deletedAt: null } });
  if (!deal) throw new NotFoundError("Deal", id);
  if (data.ownerId && !(await ctx.db.membership.findFirst({ where: { userId: data.ownerId } }))) throw new ValidationError("Owner must be a workspace member");
  if (data.contactId && !(await ctx.db.contact.findFirst({ where: { id: data.contactId, leadId: deal.leadId, deletedAt: null } }))) throw new ValidationError("Contact must belong to this lead");
  return ctx.db.deal.update({ where: { id }, data });
}

interface StageChange {
  stage: DealStage;
  position?: number;
  lostReason?: string;
  value?: number;
  /** Don't push the change back to the lead (used when the lead's status caused it). */
  fromLead?: boolean;
  reason?: string;
}

/** Applies a stage change with its events; shared by drag-and-drop, quotes and lead sync. */
export async function changeDealStage(ctx: TenantContext, deal: Deal, change: StageChange) {
  const from = deal.stage as DealStage;
  const to = change.stage;
  const now = new Date();
  const moved = from !== to;
  const updated = await ctx.db.deal.update({
    where: { id: deal.id },
    data: {
      stage: to,
      position: change.position ?? (moved ? await positionIn(ctx, to) : deal.position),
      ...(change.value !== undefined ? { value: change.value } : {}),
      ...(moved
        ? {
            stageChangedAt: now,
            // An explicit probability belonged to the old stage.
            probability: null,
            wonAt: to === "WON" ? now : null,
            lostAt: to === "LOST" ? now : null,
            lostReason: to === "LOST" ? (change.lostReason ?? deal.lostReason) : null,
          }
        : {}),
    },
  });
  if (!moved) return updated;
  const value = Number(updated.value);
  const base = { leadId: deal.leadId, dealId: deal.id, campaignId: deal.campaignId };
  await recordEvent(ctx, { ...base, type: "deal_stage_changed", properties: { title: deal.title, from, to, fromLabel: DEAL_STAGE_LABELS[from], toLabel: DEAL_STAGE_LABELS[to], value } });
  if (to === "WON") await recordEvent(ctx, { ...base, type: "deal_won", properties: { title: deal.title, value, currency: deal.currency, daysOpen: Math.round((now.getTime() - deal.createdAt.getTime()) / 86_400_000) } });
  if (to === "LOST") await recordEvent(ctx, { ...base, type: "deal_lost", properties: { title: deal.title, value, reason: change.lostReason ?? null } });
  if (!change.fromLead) await syncLeadToStage(ctx, deal.leadId, to, change.reason ?? `Deal moved to ${DEAL_STAGE_LABELS[to]}`);
  return updated;
}

export async function moveDeal(ctx: TenantContext, id: string, input: z.input<typeof dealMoveSchema>) {
  assertCan(ctx, "crm:write");
  const data = dealMoveSchema.parse(input);
  const deal = await ctx.db.deal.findFirst({ where: { id, deletedAt: null } });
  if (!deal) throw new NotFoundError("Deal", id);
  if (data.stage === "LOST" && deal.stage !== "LOST" && !data.lostReason) throw new ValidationError("Say why the deal was lost — it feeds your win/loss insights");
  const position = await positionIn(ctx, data.stage, data.prevId === id ? null : data.prevId, data.nextId === id ? null : data.nextId);
  return changeDealStage(ctx, deal, { stage: data.stage, position, lostReason: data.lostReason, value: data.value });
}

export async function deleteDeal(ctx: TenantContext, id: string) {
  assertCan(ctx, "crm:write");
  const deal = await ctx.db.deal.findFirst({ where: { id, deletedAt: null } });
  if (!deal) throw new NotFoundError("Deal", id);
  await ctx.db.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "deal.deleted", resourceType: "deal", resourceId: id, metadata: { title: deal.title, stage: deal.stage } });
}

/** The lead's open deal (latest), if any. */
export async function openDealForLead(ctx: TenantContext, leadId: string) {
  return ctx.db.deal.findFirst({ where: { leadId, deletedAt: null, stage: { in: [...OPEN_STAGES] } }, orderBy: { updatedAt: "desc" } });
}

/**
 * Makes sure the lead has a deal at (at least) this stage: creates one or moves the open one
 * forward. Never moves a deal backwards.
 */
export async function ensureDealAtStage(ctx: TenantContext, leadId: string, stage: DealStage, options: { value?: number; reason?: string; fromLead?: boolean; source?: string; sourceChannel?: Deal["sourceChannel"] } = {}) {
  const existing = await openDealForLead(ctx, leadId);
  if (!existing) {
    if (CLOSED_STAGES.includes(stage) && options.value === undefined) return null;
    return createDeal(ctx, { leadId, stage, value: options.value ?? 0 }, { source: options.source ?? "auto", sourceChannel: options.sourceChannel });
  }
  const forward = STAGE_RANK[stage] > STAGE_RANK[existing.stage as DealStage] || (CLOSED_STAGES.includes(stage) && existing.stage !== stage);
  if (!forward) {
    if (options.value !== undefined && Number(existing.value) !== options.value) return ctx.db.deal.update({ where: { id: existing.id }, data: { value: options.value } });
    return existing;
  }
  return changeDealStage(ctx, existing, { stage, value: options.value, lostReason: stage === "LOST" ? (options.reason ?? "Lead marked lost") : undefined, fromLead: options.fromLead, reason: options.reason });
}

/** Event subscriber: a lead reaching Interested / Meeting / Quote sent / Won / Lost opens or advances its deal. */
export async function syncDealFromLeadEvent(ctx: TenantContext, event: Event) {
  if (event.type !== "lead_status_changed" || !event.leadId) return;
  const to = (event.properties as { to?: LeadStatus } | null)?.to;
  const stage = to ? LEAD_TO_STAGE[to] : undefined;
  if (!stage) return;
  const channelEvent = await ctx.db.event.findFirst({
    where: { leadId: event.leadId, type: { in: ["reply_classified", "call_completed", "meeting_created", "email_replied", "whatsapp_received"] }, channel: { not: null } },
    orderBy: { occurredAt: "desc" },
    select: { channel: true },
  });
  try {
    await ensureDealAtStage(ctx, event.leadId, stage, { fromLead: true, source: "lead_status", reason: `Lead marked ${to?.toLowerCase().replace(/_/g, " ")}`, sourceChannel: channelEvent?.channel ?? null });
  } catch (error) {
    logger.warn({ err: error, leadId: event.leadId }, "deal sync from lead status failed");
    throw error;
  }
}

// ----------------------------------------------------------------------------- Reads

const pipelineInclude = {
  lead: { select: { id: true, name: true, category: true, city: true, locality: true, status: true } },
  owner: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
} satisfies Prisma.DealInclude;

export async function listPipeline(ctx: TenantContext, input: z.input<typeof pipelineQuerySchema> = {}) {
  assertCan(ctx, "crm:read");
  const query = pipelineQuerySchema.parse(input);
  const recentlyClosed = new Date(Date.now() - 30 * 86_400_000);
  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    lead: { deletedAt: null },
    OR: [{ stage: { in: [...OPEN_STAGES] } }, { wonAt: { gte: recentlyClosed } }, { lostAt: { gte: recentlyClosed } }],
    ...(query.owner === "me" && ctx.userId ? { ownerId: ctx.userId } : {}),
    ...(query.q ? { AND: [{ OR: [{ title: { contains: query.q, mode: "insensitive" } }, { lead: { name: { contains: query.q, mode: "insensitive" } } }] }] } : {}),
  };
  const deals = await ctx.db.deal.findMany({ where, include: pipelineInclude, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 500 });
  const dealIds = deals.map((deal) => deal.id);
  const leadIds = [...new Set(deals.map((deal) => deal.leadId))];
  const [tasks, quotes] = await Promise.all([
    leadIds.length
      ? ctx.db.task.findMany({ where: { status: "OPEN", OR: [{ dealId: { in: dealIds } }, { leadId: { in: leadIds } }] }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], select: { id: true, title: true, dueAt: true, dealId: true, leadId: true } })
      : [],
    leadIds.length
      ? ctx.db.quote.findMany({ where: { deletedAt: null, OR: [{ dealId: { in: dealIds } }, { leadId: { in: leadIds } }] }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, total: true, dealId: true, leadId: true } })
      : [],
  ]);

  const cards = deals.map((deal) => {
    const nextTask = tasks.find((task) => task.dealId === deal.id) ?? tasks.find((task) => task.leadId === deal.leadId && !task.dealId) ?? null;
    const quote = quotes.find((item) => item.dealId === deal.id) ?? quotes.find((item) => item.leadId === deal.leadId && !item.dealId) ?? null;
    return {
      id: deal.id,
      title: deal.title,
      stage: deal.stage as DealStage,
      value: Number(deal.value),
      currency: deal.currency,
      probability: dealProbability(deal),
      position: deal.position,
      expectedCloseDate: deal.expectedCloseDate,
      stageChangedAt: deal.stageChangedAt,
      sourceChannel: deal.sourceChannel,
      lostReason: deal.lostReason,
      lead: deal.lead,
      owner: deal.owner,
      contact: deal.contact,
      nextTask: nextTask ? { id: nextTask.id, title: nextTask.title, dueAt: nextTask.dueAt } : null,
      quote: quote ? { id: quote.id, number: quote.number, status: quote.status, total: Number(quote.total) } : null,
    };
  });

  const stages = DEAL_STAGES.map((stage) => {
    const inStage = cards.filter((card) => card.stage === stage);
    return { stage, label: DEAL_STAGE_LABELS[stage], count: inStage.length, value: inStage.reduce((sum, card) => sum + card.value, 0) };
  });
  return { deals: cards, stages, summary: await pipelineSummary(ctx) };
}

export async function pipelineSummary(ctx: TenantContext) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterAgo = new Date(now.getTime() - 90 * 86_400_000);
  const [open, wonMonth, closedQuarter] = await Promise.all([
    ctx.db.deal.findMany({ where: { deletedAt: null, stage: { in: [...OPEN_STAGES] }, lead: { deletedAt: null } }, select: { value: true, probability: true, stage: true } }),
    ctx.db.deal.aggregate({ where: { deletedAt: null, stage: "WON", wonAt: { gte: monthStart } }, _sum: { value: true }, _count: true }),
    ctx.db.deal.findMany({ where: { deletedAt: null, OR: [{ wonAt: { gte: quarterAgo } }, { lostAt: { gte: quarterAgo } }] }, select: { stage: true, value: true } }),
  ]);
  const won = closedQuarter.filter((deal) => deal.stage === "WON");
  const lost = closedQuarter.filter((deal) => deal.stage === "LOST");
  return {
    openCount: open.length,
    openValue: open.reduce((sum, deal) => sum + Number(deal.value), 0),
    weightedValue: Math.round(open.reduce((sum, deal) => sum + (Number(deal.value) * dealProbability(deal)) / 100, 0)),
    wonThisMonth: { count: wonMonth._count, value: Number(wonMonth._sum.value ?? 0) },
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    averageWon: won.length ? Math.round(won.reduce((sum, deal) => sum + Number(deal.value), 0) / won.length) : null,
  };
}

export async function getDeal(ctx: TenantContext, id: string) {
  assertCan(ctx, "crm:read");
  const deal = await ctx.db.deal.findFirst({
    where: { id, deletedAt: null },
    include: { ...pipelineInclude, lead: { select: { id: true, name: true, category: true, city: true, locality: true, status: true, email: true, phone: true, website: true, ownerId: true } }, campaign: { select: { id: true, name: true } } },
  });
  if (!deal) throw new NotFoundError("Deal", id);
  const related = { OR: [{ dealId: id }, { leadId: deal.leadId }] };
  const [tasks, notes, meetings, quotes, events, contacts] = await Promise.all([
    ctx.db.task.findMany({ where: related, orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }], take: 50, include: { assignee: { select: { id: true, name: true } } } }),
    ctx.db.note.findMany({ where: { ...related, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 30, include: { author: { select: { id: true, name: true } } } }),
    ctx.db.meeting.findMany({ where: related, orderBy: { scheduledAt: "desc" }, take: 20 }),
    ctx.db.quote.findMany({ where: { ...related, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, number: true, title: true, status: true, total: true, currency: true, sentAt: true, createdAt: true, validUntil: true } }),
    ctx.db.event.findMany({ where: { ...related, type: { notIn: ["ai_request", "ai_response"] } }, orderBy: { occurredAt: "desc" }, take: 40 }),
    ctx.db.contact.findMany({ where: { leadId: deal.leadId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, title: true, email: true, phone: true } }),
  ]);
  return {
    ...deal,
    value: Number(deal.value),
    probability: dealProbability(deal),
    explicitProbability: deal.probability,
    tasks,
    notes,
    meetings,
    quotes: quotes.map((quote) => ({ ...quote, total: Number(quote.total) })),
    events,
    contacts,
  };
}

export async function listLeadDeals(ctx: TenantContext, leadId: string) {
  assertCan(ctx, "crm:read");
  const deals = await ctx.db.deal.findMany({ where: { leadId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { owner: { select: { id: true, name: true } } } });
  return deals.map((deal) => ({ ...deal, value: Number(deal.value), probability: dealProbability(deal) }));
}
