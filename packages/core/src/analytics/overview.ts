import { DEAL_STAGE_PROBABILITY, POSITIVE_INTENTS } from "@repo/config";
import { Prisma } from "@repo/db";
import type { TenantContext } from "../context";
import { delta, eventFilterSql, ratio, resolveFilters, type AnalyticsFilterInput, type ResolvedFilters } from "./filters";

/**
 * Overview analytics. Every number is derived from the immutable event log (plus the
 * current deal/lead tables for pipeline snapshots) — nothing is stored pre-aggregated
 * that could drift from the source of truth.
 */

const POSITIVE = [...POSITIVE_INTENTS];
const OUTREACH_TYPES = ["email_sent", "whatsapp_sent"];
const REPLY_TYPES = ["email_replied", "whatsapp_received"];

interface PeriodCounts {
  leadsCreated: number;
  leadsQualified: number;
  outreachSent: number;
  replies: number;
  positiveReplies: number;
  callsCompleted: number;
  callsAnswered: number;
  meetings: number;
  quotesSent: number;
  dealsWon: number;
  revenue: number;
  contactedLeads: number;
}

async function periodCounts(ctx: TenantContext, from: Date, to: Date, filters: ResolvedFilters): Promise<PeriodCounts> {
  const where = eventFilterSql(filters);
  const rows = await ctx.db.$queryRaw<
    Array<{
      leads_created: number;
      leads_qualified: number;
      outreach_sent: number;
      replies: number;
      positive_replies: number;
      calls_completed: number;
      calls_answered: number;
      meetings: number;
      quotes_sent: number;
      deals_won: number;
      revenue: number;
      contacted_leads: number;
    }>
  >`
    SELECT
      count(*) FILTER (WHERE e.type = 'lead_created')::int AS leads_created,
      count(*) FILTER (WHERE e.type = 'lead_qualified')::int AS leads_qualified,
      count(*) FILTER (WHERE e.type::text = ANY(${OUTREACH_TYPES}))::int AS outreach_sent,
      count(*) FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}))::int AS replies,
      count(*) FILTER (WHERE e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))::int AS positive_replies,
      count(*) FILTER (WHERE e.type = 'call_completed')::int AS calls_completed,
      count(*) FILTER (WHERE e.type = 'call_answered')::int AS calls_answered,
      count(*) FILTER (WHERE e.type = 'meeting_created')::int AS meetings,
      count(*) FILTER (WHERE e.type = 'quote_sent')::int AS quotes_sent,
      count(*) FILTER (WHERE e.type = 'deal_won')::int AS deals_won,
      coalesce(sum(e.value) FILTER (WHERE e.type = 'deal_won'), 0)::float AS revenue,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${[...OUTREACH_TYPES, "call_completed"]}))::int AS contacted_leads
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
      ${where}`;
  const row = rows[0];
  return {
    leadsCreated: row?.leads_created ?? 0,
    leadsQualified: row?.leads_qualified ?? 0,
    outreachSent: row?.outreach_sent ?? 0,
    replies: row?.replies ?? 0,
    positiveReplies: row?.positive_replies ?? 0,
    callsCompleted: row?.calls_completed ?? 0,
    callsAnswered: row?.calls_answered ?? 0,
    meetings: row?.meetings ?? 0,
    quotesSent: row?.quotes_sent ?? 0,
    dealsWon: row?.deals_won ?? 0,
    revenue: row?.revenue ?? 0,
    contactedLeads: row?.contacted_leads ?? 0,
  };
}

async function aiCost(ctx: TenantContext, from: Date, to: Date, campaignId?: string): Promise<number> {
  const result = await ctx.db.aIRequest.aggregate({
    where: { createdAt: { gte: from, lt: to }, ...(campaignId ? { campaignId } : {}) },
    _sum: { costMicroUsd: true },
  });
  return result._sum.costMicroUsd ?? 0;
}

async function voiceCost(ctx: TenantContext, from: Date, to: Date, campaignId?: string): Promise<number> {
  const result = await ctx.db.call.aggregate({
    where: { createdAt: { gte: from, lt: to }, ...(campaignId ? { campaignId } : {}) },
    _sum: { costCents: true },
  });
  return result._sum.costCents ?? 0;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  previous: number;
  delta: number | null;
  format: "number" | "percent" | "currency" | "usd_micro";
  upIsGood: boolean;
  hint?: string;
}

export interface TimeSeriesPoint {
  date: string;
  leads: number;
  outreach: number;
  replies: number;
  positive: number;
}

export async function dailySeries(ctx: TenantContext, filters: ResolvedFilters, timezone: string): Promise<TimeSeriesPoint[]> {
  const where = eventFilterSql(filters);
  const rows = await ctx.db.$queryRaw<Array<{ day: string; leads: number; outreach: number; replies: number; positive: number }>>`
    SELECT
      to_char(date_trunc('day', (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE e.type = 'lead_created')::int AS leads,
      count(*) FILTER (WHERE e.type::text = ANY(${OUTREACH_TYPES}))::int AS outreach,
      count(*) FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}))::int AS replies,
      count(*) FILTER (WHERE e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))::int AS positive
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${where}
    GROUP BY 1
    ORDER BY 1`;

  // Fill gaps so charts show zero-activity days.
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: TimeSeriesPoint[] = [];
  const cursor = new Date(filters.from);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const seen = new Set<string>();
  while (cursor < filters.to) {
    const day = formatter.format(cursor);
    if (!seen.has(day)) {
      seen.add(day);
      const row = byDay.get(day);
      points.push({ date: day, leads: row?.leads ?? 0, outreach: row?.outreach ?? 0, replies: row?.replies ?? 0, positive: row?.positive ?? 0 });
    }
    cursor.setTime(cursor.getTime() + 86_400_000);
  }
  return points;
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
}

export async function funnel(ctx: TenantContext, filters: ResolvedFilters): Promise<FunnelStage[]> {
  const where = eventFilterSql(filters);
  const rows = await ctx.db.$queryRaw<
    Array<{ created: number; qualified: number; contacted: number; replied: number; interested: number; meeting: number; quote: number; won: number }>
  >`
    SELECT
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_created')::int AS created,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_qualified')::int AS qualified,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${[...OUTREACH_TYPES, "call_completed"]}))::int AS contacted,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')::int AS replied,
      count(DISTINCT e."leadId") FILTER (
        WHERE (e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))
           OR (e.type = 'call_completed' AND e.properties->>'outcome' IN ('INTERESTED', 'MEETING_REQUESTED'))
      )::int AS interested,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'meeting_created')::int AS meeting,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'quote_sent')::int AS quote,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'deal_won')::int AS won
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."leadId" IS NOT NULL
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${where}`;
  const row = rows[0];
  return [
    { key: "created", label: "Leads", value: row?.created ?? 0 },
    { key: "qualified", label: "Qualified", value: row?.qualified ?? 0 },
    { key: "contacted", label: "Contacted", value: row?.contacted ?? 0 },
    { key: "replied", label: "Replied", value: row?.replied ?? 0 },
    { key: "interested", label: "Interested", value: row?.interested ?? 0 },
    { key: "meeting", label: "Meeting", value: row?.meeting ?? 0 },
    { key: "quote", label: "Quote", value: row?.quote ?? 0 },
    { key: "won", label: "Won", value: row?.won ?? 0 },
  ];
}

export interface ChannelPerformance {
  channel: string;
  sent: number;
  replies: number;
  positive: number;
  replyRate: number | null;
  positiveRate: number | null;
}

export async function channelPerformance(ctx: TenantContext, filters: ResolvedFilters): Promise<ChannelPerformance[]> {
  const where = eventFilterSql(filters);
  const rows = await ctx.db.$queryRaw<Array<{ channel: string; sent: number; replies: number; positive: number }>>`
    SELECT
      e.channel::text AS channel,
      count(*) FILTER (WHERE e.type::text = ANY(${[...OUTREACH_TYPES, "call_completed"]}))::int AS sent,
      count(*) FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')::int AS replies,
      count(*) FILTER (
        WHERE (e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))
           OR (e.type = 'call_completed' AND e.properties->>'outcome' IN ('INTERESTED', 'MEETING_REQUESTED'))
      )::int AS positive
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e.channel IS NOT NULL
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${where}
    GROUP BY 1
    ORDER BY 2 DESC`;
  return rows.map((row) => ({
    ...row,
    replyRate: ratio(row.replies, row.sent),
    positiveRate: ratio(row.positive, row.sent),
  }));
}

export async function scoreDistribution(ctx: TenantContext): Promise<Array<{ bucket: string; count: number }>> {
  const rows = await ctx.db.$queryRaw<Array<{ bucket: number; count: number }>>`
    SELECT LEAST(width_bucket(score, 0, 100, 5), 5)::int AS bucket, count(*)::int AS count
    FROM leads
    WHERE "organizationId" = ${ctx.organizationId}::uuid AND "deletedAt" IS NULL AND score IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const labels = ["0–19", "20–39", "40–59", "60–79", "80–100"];
  const byBucket = new Map(rows.map((row) => [row.bucket, row.count]));
  return labels.map((bucket, index) => ({ bucket, count: byBucket.get(index + 1) ?? 0 }));
}

export interface CampaignPerformanceRow {
  campaignId: string;
  name: string;
  status: string;
  leads: number;
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
  won: number;
  revenue: number;
  replyRate: number | null;
}

export async function campaignPerformance(ctx: TenantContext, filters: ResolvedFilters): Promise<CampaignPerformanceRow[]> {
  const rows = await ctx.db.$queryRaw<
    Array<{ campaign_id: string; name: string; status: string; leads: number; sent: number; replies: number; positive: number; meetings: number; won: number; revenue: number }>
  >`
    SELECT
      c.id AS campaign_id, c.name, c.status::text AS status,
      (SELECT count(*) FROM campaign_leads cl WHERE cl."campaignId" = c.id)::int AS leads,
      count(e.id) FILTER (WHERE e.type::text = ANY(${[...OUTREACH_TYPES, "call_completed"]}))::int AS sent,
      count(e.id) FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}))::int AS replies,
      count(e.id) FILTER (WHERE e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))::int AS positive,
      count(e.id) FILTER (WHERE e.type = 'meeting_created')::int AS meetings,
      count(e.id) FILTER (WHERE e.type = 'deal_won')::int AS won,
      coalesce(sum(e.value) FILTER (WHERE e.type = 'deal_won'), 0)::float AS revenue
    FROM campaigns c
    LEFT JOIN events e
      ON e."campaignId" = c.id
     AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
    WHERE c."organizationId" = ${ctx.organizationId}::uuid AND c."deletedAt" IS NULL
      ${filters.campaignId ? Prisma.sql`AND c.id = ${filters.campaignId}::uuid` : Prisma.empty}
    GROUP BY c.id
    ORDER BY sent DESC, c."createdAt" DESC
    LIMIT 20`;
  return rows.map((row) => ({
    campaignId: row.campaign_id,
    name: row.name,
    status: row.status,
    leads: row.leads,
    sent: row.sent,
    replies: row.replies,
    positive: row.positive,
    meetings: row.meetings,
    won: row.won,
    revenue: row.revenue,
    replyRate: ratio(row.replies, row.sent),
  }));
}

export async function pipelineSnapshot(ctx: TenantContext) {
  const deals = await ctx.db.deal.groupBy({
    by: ["stage"],
    where: { deletedAt: null },
    _sum: { value: true },
    _count: { _all: true },
  });
  const open = deals.filter((deal) => deal.stage !== "WON" && deal.stage !== "LOST");
  const weighted = open.reduce((sum, deal) => sum + Number(deal._sum.value ?? 0) * (DEAL_STAGE_PROBABILITY[deal.stage] / 100), 0);
  return {
    openDeals: open.reduce((sum, deal) => sum + deal._count._all, 0),
    openValue: open.reduce((sum, deal) => sum + Number(deal._sum.value ?? 0), 0),
    weightedValue: weighted,
    byStage: deals.map((deal) => ({ stage: deal.stage, count: deal._count._all, value: Number(deal._sum.value ?? 0) })),
  };
}

export async function getOverview(ctx: TenantContext, input: AnalyticsFilterInput, timezone: string) {
  const filters = resolveFilters(input);
  const [current, previous, series, stages, channels, distribution, campaigns, pipeline, aiNow, aiPrev, voiceNow, voicePrev, totalLeads] =
    await Promise.all([
      periodCounts(ctx, filters.from, filters.to, filters),
      periodCounts(ctx, filters.previousFrom, filters.previousTo, filters),
      dailySeries(ctx, filters, timezone),
      funnel(ctx, filters),
      channelPerformance(ctx, filters),
      scoreDistribution(ctx),
      campaignPerformance(ctx, filters),
      pipelineSnapshot(ctx),
      aiCost(ctx, filters.from, filters.to, filters.campaignId),
      aiCost(ctx, filters.previousFrom, filters.previousTo, filters.campaignId),
      voiceCost(ctx, filters.from, filters.to, filters.campaignId),
      voiceCost(ctx, filters.previousFrom, filters.previousTo, filters.campaignId),
      ctx.db.lead.count({ where: { deletedAt: null } }),
    ]);

  const conversion = ratio(current.dealsWon, current.contactedLeads);
  const previousConversion = ratio(previous.dealsWon, previous.contactedLeads);
  const replyRate = ratio(current.replies, current.outreachSent);
  const previousReplyRate = ratio(previous.replies, previous.outreachSent);
  // Voice cost is stored in cents of the org currency; AI cost in micro-USD. They are
  // reported separately rather than summed across currencies.
  const kpis: Kpi[] = [
    { key: "leads", label: "New leads", value: current.leadsCreated, previous: previous.leadsCreated, delta: delta(current.leadsCreated, previous.leadsCreated), format: "number", upIsGood: true, hint: `${totalLeads.toLocaleString()} total in workspace` },
    { key: "qualified", label: "Qualified leads", value: current.leadsQualified, previous: previous.leadsQualified, delta: delta(current.leadsQualified, previous.leadsQualified), format: "number", upIsGood: true },
    { key: "outreach", label: "Outreach sent", value: current.outreachSent, previous: previous.outreachSent, delta: delta(current.outreachSent, previous.outreachSent), format: "number", upIsGood: true },
    { key: "replies", label: "Replies", value: current.replies, previous: previous.replies, delta: delta(current.replies, previous.replies), format: "number", upIsGood: true, hint: replyRate === null ? undefined : `${(replyRate * 100).toFixed(1)}% reply rate` },
    { key: "positive", label: "Positive replies", value: current.positiveReplies, previous: previous.positiveReplies, delta: delta(current.positiveReplies, previous.positiveReplies), format: "number", upIsGood: true },
    { key: "calls", label: "Calls", value: current.callsCompleted, previous: previous.callsCompleted, delta: delta(current.callsCompleted, previous.callsCompleted), format: "number", upIsGood: true, hint: current.callsCompleted ? `${current.callsAnswered} answered` : undefined },
    { key: "meetings", label: "Meetings", value: current.meetings, previous: previous.meetings, delta: delta(current.meetings, previous.meetings), format: "number", upIsGood: true },
    { key: "quotes", label: "Quotes sent", value: current.quotesSent, previous: previous.quotesSent, delta: delta(current.quotesSent, previous.quotesSent), format: "number", upIsGood: true },
    { key: "won", label: "Deals won", value: current.dealsWon, previous: previous.dealsWon, delta: delta(current.dealsWon, previous.dealsWon), format: "number", upIsGood: true },
    { key: "conversion", label: "Conversion rate", value: conversion ?? 0, previous: previousConversion ?? 0, delta: conversion === null || previousConversion === null ? null : conversion - previousConversion, format: "percent", upIsGood: true, hint: "Deals won ÷ leads contacted" },
    { key: "revenue", label: "Revenue won", value: current.revenue, previous: previous.revenue, delta: delta(current.revenue, previous.revenue), format: "currency", upIsGood: true, hint: `${Math.round(pipeline.weightedValue).toLocaleString()} weighted pipeline` },
    { key: "aiCost", label: "AI cost", value: aiNow, previous: aiPrev, delta: delta(aiNow, aiPrev), format: "usd_micro", upIsGood: false, hint: voiceNow || voicePrev ? `Voice: ${(voiceNow / 100).toFixed(2)} (org currency)` : undefined },
  ];

  return {
    range: { from: filters.from.toISOString(), to: filters.to.toISOString(), days: filters.days },
    kpis,
    replyRate: { current: replyRate, previous: previousReplyRate },
    series,
    funnel: stages,
    channels,
    scoreDistribution: distribution,
    campaigns,
    pipeline,
    hasData: current.leadsCreated + current.outreachSent + totalLeads > 0,
  };
}

export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
