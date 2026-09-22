import { CHANNEL_LABELS, CHANNEL_UNIT_COST_USD, POSITIVE_INTENTS, USD_EXCHANGE_RATE, usdTo, type Channel } from "@repo/config";
import { getCategory } from "@repo/config/taxonomy";
import { Prisma } from "@repo/db";
import { resolvePlan } from "../billing/plans";
import { assertCan, type TenantContext } from "../context";
import { CONTACT_EVENT_TYPES, delta, eventFilterSql, hasLeadFilters, leadClauses, ratio, resolveFilters, type AnalyticsFilterInput, type ResolvedFilters } from "./filters";

/**
 * The analytics report. Every number is computed from the immutable event log (and, for
 * costs, from stored AI requests and calls) at query time — nothing pre-aggregated can drift
 * from the source of truth. Lead-level rates are per *contacted lead*, so a lead that got
 * three emails and replied once counts once.
 */

const POSITIVE = [...POSITIVE_INTENTS];
const REPLY_TYPES = ["email_replied", "whatsapp_received"];
const POSITIVE_CALL_OUTCOMES = ["INTERESTED", "MEETING_REQUESTED"];
const CONTACT = CONTACT_EVENT_TYPES;

// ----------------------------------------------------------------------------- Counts

interface Counts {
  leads: number;
  qualified: number;
  emailSent: number;
  whatsappSent: number;
  delivered: number;
  emailDelivered: number;
  opened: number;
  contacted: number;
  replied: number;
  positive: number;
  callsPlaced: number;
  callsAnswered: number;
  meetings: number;
  meetingLeads: number;
  quotes: number;
  quotedLeads: number;
  won: number;
  wonLeads: number;
  revenue: number;
}

export async function counts(ctx: TenantContext, from: Date, to: Date, filters: ResolvedFilters): Promise<Counts> {
  const rows = await ctx.db.$queryRaw<Array<Record<string, number>>>`
    SELECT
      count(*) FILTER (WHERE e.type = 'lead_created')::int AS leads,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_qualified')::int AS qualified,
      count(*) FILTER (WHERE e.type = 'email_sent')::int AS email_sent,
      count(*) FILTER (WHERE e.type = 'whatsapp_sent')::int AS whatsapp_sent,
      count(*) FILTER (WHERE e.type IN ('email_delivered', 'whatsapp_delivered'))::int AS delivered,
      count(*) FILTER (WHERE e.type = 'email_delivered')::int AS email_delivered,
      count(DISTINCT e."messageId") FILTER (WHERE e.type = 'email_opened')::int AS opened,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${CONTACT}))::int AS contacted,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')::int AS replied,
      count(DISTINCT e."leadId") FILTER (
        WHERE (e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))
           OR (e.type = 'call_completed' AND e.properties->>'outcome' = ANY(${POSITIVE_CALL_OUTCOMES}))
      )::int AS positive,
      count(DISTINCT e."callId") FILTER (WHERE e.type IN ('call_started', 'call_failed', 'call_answered', 'call_completed'))::int AS calls_placed,
      count(DISTINCT e."callId") FILTER (WHERE e.type IN ('call_answered', 'call_completed'))::int AS calls_answered,
      count(*) FILTER (WHERE e.type = 'meeting_created')::int AS meetings,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'meeting_created')::int AS meeting_leads,
      count(*) FILTER (WHERE e.type = 'quote_sent')::int AS quotes,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'quote_sent')::int AS quoted_leads,
      count(*) FILTER (WHERE e.type = 'deal_won')::int AS won,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'deal_won')::int AS won_leads,
      coalesce(sum(e.value) FILTER (WHERE e.type = 'deal_won'), 0)::float AS revenue
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
      ${eventFilterSql(filters)}`;
  const row = rows[0] ?? {};
  const get = (key: string) => Number(row[key] ?? 0);
  return {
    leads: get("leads"),
    qualified: get("qualified"),
    emailSent: get("email_sent"),
    whatsappSent: get("whatsapp_sent"),
    delivered: get("delivered"),
    emailDelivered: get("email_delivered"),
    opened: get("opened"),
    contacted: get("contacted"),
    replied: get("replied"),
    positive: get("positive"),
    callsPlaced: get("calls_placed"),
    callsAnswered: get("calls_answered"),
    meetings: get("meetings"),
    meetingLeads: get("meeting_leads"),
    quotes: get("quotes"),
    quotedLeads: get("quoted_leads"),
    won: get("won"),
    wonLeads: get("won_leads"),
    revenue: get("revenue"),
  };
}

// ----------------------------------------------------------------------------- Costs

interface Costs {
  /** In the workspace currency. */
  ai: number;
  messaging: number;
  voice: number;
  /** The platform plan, prorated to the period. */
  subscription: number;
  total: number;
  aiMicroUsd: number;
}

function leadExists(filters: ResolvedFilters, column: Prisma.Sql): Prisma.Sql {
  const clauses = leadClauses(filters);
  return clauses.length ? Prisma.sql`AND EXISTS (SELECT 1 FROM leads l WHERE l.id = ${column} AND ${Prisma.join(clauses, " AND ")})` : Prisma.empty;
}

async function costs(ctx: TenantContext, from: Date, to: Date, filters: ResolvedFilters, currency: string, sent: Pick<Counts, "emailSent" | "whatsappSent">, plan: { priceMonthly: number; currency: string }): Promise<Costs> {
  const campaign = filters.campaignId ? Prisma.sql`AND "campaignId" = ${filters.campaignId}::uuid` : Prisma.empty;
  const [ai, calls] = await Promise.all([
    ctx.db.$queryRaw<Array<{ micro: number }>>`
      SELECT coalesce(sum("costMicroUsd"), 0)::float AS micro
      FROM ai_requests
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "createdAt" >= ${from} AND "createdAt" < ${to}
        ${campaign} ${leadExists(filters, Prisma.sql`ai_requests."leadId"`)}`,
    ctx.db.$queryRaw<Array<{ cents: number; estimated_seconds: number }>>`
      SELECT coalesce(sum("costCents"), 0)::float AS cents,
             coalesce(sum("durationSeconds") FILTER (WHERE "costCents" IS NULL AND type = 'AI_AGENT'), 0)::float AS estimated_seconds
      FROM calls
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "createdAt" >= ${from} AND "createdAt" < ${to}
        ${campaign} ${leadExists(filters, Prisma.sql`calls."leadId"`)}
        ${filters.channel && filters.channel !== "VOICE" ? Prisma.sql`AND false` : Prisma.empty}`,
  ]);
  const aiMicroUsd = ai[0]?.micro ?? 0;
  const aiCost = usdTo(currency, aiMicroUsd / 1_000_000);
  const messaging = usdTo(currency, sent.emailSent * CHANNEL_UNIT_COST_USD.EMAIL + sent.whatsappSent * CHANNEL_UNIT_COST_USD.WHATSAPP);
  const voice = (calls[0]?.cents ?? 0) / 100 + usdTo(currency, ((calls[0]?.estimated_seconds ?? 0) / 60) * CHANNEL_UNIT_COST_USD.VOICE_PER_MINUTE);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  const planUsd = plan.currency === "USD" ? plan.priceMonthly / 100 : plan.priceMonthly / 100 / (USD_EXCHANGE_RATE[plan.currency] ?? 1);
  const subscription = usdTo(currency, (planUsd * days) / 30);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { ai: round(aiCost), messaging: round(messaging), voice: round(voice), subscription: round(subscription), total: round(aiCost + messaging + voice + subscription), aiMicroUsd };
}

// ----------------------------------------------------------------------------- Metrics

export type MetricFormat = "number" | "percent" | "currency" | "multiple";

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  /** Relative change for counts/currency; absolute percentage-point change for rates. */
  delta: number | null;
  format: MetricFormat;
  upIsGood: boolean;
  definition: string;
  /** For rates: the counts behind them, so the UI can show "12 of 40". */
  numerator?: number;
  denominator?: number;
}

function count(key: string, label: string, current: number, previous: number, definition: string, upIsGood = true): Metric {
  return { key, label, value: current, previous, delta: delta(current, previous), format: "number", upIsGood, definition };
}

function rate(key: string, label: string, numerator: number, denominator: number, prevNumerator: number, prevDenominator: number, definition: string, upIsGood = true): Metric {
  const value = ratio(numerator, denominator);
  const previous = ratio(prevNumerator, prevDenominator);
  return { key, label, value, previous, delta: value !== null && previous !== null ? value - previous : null, format: "percent", upIsGood, definition, numerator, denominator };
}

function money(key: string, label: string, current: number | null, previous: number | null, definition: string, upIsGood = true): Metric {
  return { key, label, value: current, previous, delta: current !== null && previous !== null ? delta(current, previous) : null, format: "currency", upIsGood, definition };
}

const per = (cost: number, units: number) => (units > 0 ? Math.round((cost / units) * 100) / 100 : null);
const roi = (revenue: number, cost: number) => (cost > 0 ? (revenue - cost) / cost : null);

function metricGroups(now: Counts, before: Counts, costNow: Costs, costBefore: Costs) {
  const outreachNow = now.emailSent + now.whatsappSent;
  const outreachBefore = before.emailSent + before.whatsappSent;
  const roiNow = roi(now.revenue, costNow.total);
  const roiBefore = roi(before.revenue, costBefore.total);
  return [
    {
      key: "acquisition",
      label: "Acquisition",
      metrics: [
        count("leads", "New leads", now.leads, before.leads, "Leads added by discovery, import or by hand."),
        count("qualified", "Qualified leads", now.qualified, before.qualified, "Leads that crossed the qualification threshold."),
        rate("qualificationRate", "Qualification rate", now.qualified, now.leads, before.qualified, before.leads, "Qualified leads ÷ new leads in the period."),
        money("costPerLead", "Cost per lead", per(costNow.total, now.leads), per(costBefore.total, before.leads), "Total cost ÷ new leads.", false),
      ],
    },
    {
      key: "engagement",
      label: "Engagement",
      metrics: [
        count("outreach", "Outreach sent", outreachNow, outreachBefore, "Emails and WhatsApp messages sent."),
        rate("deliveryRate", "Delivery rate", now.delivered, outreachNow, before.delivered, outreachBefore, "Delivered ÷ sent (email and WhatsApp)."),
        rate("openRate", "Open rate", now.opened, now.emailDelivered, before.opened, before.emailDelivered, "Opened emails ÷ delivered emails. Opens are approximate (image blocking)."),
        rate("replyRate", "Reply rate", now.replied, now.contacted, before.replied, before.contacted, "Leads who replied or answered a call ÷ leads contacted."),
        rate("positiveReplyRate", "Positive reply rate", now.positive, now.contacted, before.positive, before.contacted, "Leads with a positive reply or call outcome ÷ leads contacted."),
        rate("callAnswerRate", "Call answer rate", now.callsAnswered, now.callsPlaced, before.callsAnswered, before.callsPlaced, "Calls answered ÷ calls placed."),
      ],
    },
    {
      key: "conversion",
      label: "Conversion",
      metrics: [
        rate("meetingRate", "Meeting rate", now.meetingLeads, now.contacted, before.meetingLeads, before.contacted, "Leads with a booked meeting ÷ leads contacted."),
        rate("quoteRate", "Quote rate", now.quotedLeads, now.contacted, before.quotedLeads, before.contacted, "Leads sent a quote ÷ leads contacted."),
        rate("conversionRate", "Conversion rate", now.wonLeads, now.contacted, before.wonLeads, before.contacted, "Leads with a won deal ÷ leads contacted."),
        money("revenue", "Revenue won", now.revenue, before.revenue, "Value of deals won (before tax)."),
      ],
    },
    {
      key: "efficiency",
      label: "Cost & ROI",
      metrics: [
        money("aiCost", "AI cost", costNow.ai, costBefore.ai, "Model usage for every AI agent, converted from USD at an estimated rate.", false),
        money("channelCost", "Channel & automation cost", costNow.messaging + costNow.voice, costBefore.messaging + costBefore.voice, "Estimated email and WhatsApp fees plus voice minutes.", false),
        money("costPerQualifiedLead", "Cost per qualified lead", per(costNow.total, now.qualified), per(costBefore.total, before.qualified), "Total cost ÷ qualified leads.", false),
        money("costPerMeeting", "Cost per meeting", per(costNow.total, now.meetings), per(costBefore.total, before.meetings), "Total cost ÷ meetings booked.", false),
        money("totalCost", "Total cost", costNow.total, costBefore.total, "AI + channel fees + voice + your plan, prorated to the period.", false),
        { key: "roi", label: "Estimated ROI", value: roiNow, previous: roiBefore, delta: roiNow !== null && roiBefore !== null ? roiNow - roiBefore : null, format: "multiple" as const, upIsGood: true, definition: "(Revenue won − total cost) ÷ total cost, as a multiple of what you spent. Team time isn't included." },
      ],
    },
  ];
}

// ----------------------------------------------------------------------------- Series

export interface SeriesPoint {
  date: string;
  leads: number;
  outreach: number;
  replies: number;
  positive: number;
  meetings: number;
  won: number;
  revenue: number;
}

async function series(ctx: TenantContext, filters: ResolvedFilters, timezone: string): Promise<{ bucket: "day" | "week"; points: SeriesPoint[] }> {
  const bucket: "day" | "week" = filters.days > 92 ? "week" : "day";
  const unit = Prisma.raw(`'${bucket}'`);
  const rows = await ctx.db.$queryRaw<Array<SeriesPoint & { date: string }>>`
    SELECT
      to_char(date_trunc(${unit}, e."occurredAt" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS date,
      count(*) FILTER (WHERE e.type = 'lead_created')::int AS leads,
      count(*) FILTER (WHERE e.type IN ('email_sent', 'whatsapp_sent'))::int AS outreach,
      count(*) FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}))::int AS replies,
      count(*) FILTER (WHERE e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))::int AS positive,
      count(*) FILTER (WHERE e.type = 'meeting_created')::int AS meetings,
      count(*) FILTER (WHERE e.type = 'deal_won')::int AS won,
      coalesce(sum(e.value) FILTER (WHERE e.type = 'deal_won'), 0)::float AS revenue
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${eventFilterSql(filters)}
    GROUP BY 1 ORDER BY 1`;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  // Every bucket in the range is present, so gaps read as zero instead of being skipped.
  const points: SeriesPoint[] = [];
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const seen = new Set<string>();
  const cursor = new Date(filters.from);
  if (bucket === "week") {
    // Align to the Monday of the first week (date_trunc('week') is ISO, Monday-based).
    const local = new Date(format.format(cursor));
    cursor.setTime(cursor.getTime() - ((local.getUTCDay() + 6) % 7) * 86_400_000);
  }
  while (cursor < filters.to) {
    const date = format.format(cursor);
    if (!seen.has(date)) {
      seen.add(date);
      const row = byDate.get(date);
      points.push({ date, leads: row?.leads ?? 0, outreach: row?.outreach ?? 0, replies: row?.replies ?? 0, positive: row?.positive ?? 0, meetings: row?.meetings ?? 0, won: row?.won ?? 0, revenue: row?.revenue ?? 0 });
    }
    cursor.setTime(cursor.getTime() + (bucket === "week" ? 7 : 1) * 86_400_000);
  }
  return { bucket, points };
}

// ----------------------------------------------------------------------------- Funnel

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
}

async function funnel(ctx: TenantContext, filters: ResolvedFilters): Promise<FunnelStep[]> {
  const rows = await ctx.db.$queryRaw<Array<Record<string, number>>>`
    SELECT
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_created')::int AS created,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_qualified')::int AS qualified,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${CONTACT}))::int AS contacted,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')::int AS replied,
      count(DISTINCT e."leadId") FILTER (
        WHERE (e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))
           OR (e.type = 'call_completed' AND e.properties->>'outcome' = ANY(${POSITIVE_CALL_OUTCOMES}))
      )::int AS interested,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'meeting_created')::int AS meeting,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'quote_sent')::int AS quote,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'deal_won')::int AS won
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid AND e."leadId" IS NOT NULL
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${eventFilterSql(filters)}`;
  const row = rows[0] ?? {};
  return [
    ["created", "Leads"],
    ["qualified", "Qualified"],
    ["contacted", "Contacted"],
    ["replied", "Replied"],
    ["interested", "Interested"],
    ["meeting", "Meeting"],
    ["quote", "Quote"],
    ["won", "Won"],
  ].map(([key, label]) => ({ key: key!, label: label!, value: Number(row[key!] ?? 0) }));
}

// ----------------------------------------------------------------------------- Breakdowns

export const BREAKDOWN_DIMENSIONS = ["channel", "campaign", "city", "area", "category", "source", "score", "fit"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export interface BreakdownRow {
  key: string;
  label: string;
  leads: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  won: number;
  revenue: number;
  replyRate: number | null;
  positiveRate: number | null;
  meetingRate: number | null;
  /** Estimated channel cost where it can be attributed (channel and campaign breakdowns). */
  cost?: number | null;
}

const SCORE_BAND = Prisma.sql`CASE WHEN l.score IS NULL THEN 'Unscored' WHEN l.score >= 80 THEN '80–100' WHEN l.score >= 60 THEN '60–79' WHEN l.score >= 40 THEN '40–59' ELSE '0–39' END`;

function dimensionSql(dimension: BreakdownDimension): Prisma.Sql {
  switch (dimension) {
    case "channel":
      return Prisma.sql`e.channel::text`;
    case "campaign":
      return Prisma.sql`e."campaignId"::text`;
    case "city":
      return Prisma.sql`coalesce(l.city, 'Unknown')`;
    case "area":
      return Prisma.sql`coalesce(l.locality, l.city, 'Unknown')`;
    case "category":
      return Prisma.sql`coalesce(l.category, 'Unknown')`;
    case "source":
      return Prisma.sql`l."sourceProvider"`;
    case "score":
      return SCORE_BAND;
    case "fit":
      return Prisma.sql`coalesce(l."fitTier"::text, 'Unscored')`;
  }
}

const SOURCE_LABELS: Record<string, string> = { mock: "Demo data", google_places: "Google Places", openstreetmap: "OpenStreetMap", manual: "Added manually", csv: "CSV import", import: "CSV import" };

export async function breakdown(ctx: TenantContext, filters: ResolvedFilters, dimension: BreakdownDimension, currency: string, limit = 12): Promise<BreakdownRow[]> {
  const dim = dimensionSql(dimension);
  const byEvent = dimension === "channel" || dimension === "campaign";
  const rows = await ctx.db.$queryRaw<Array<{ key: string | null; leads: number; contacted: number; replied: number; positive: number; meetings: number; won: number; revenue: number; email_sent: number; whatsapp_sent: number }>>`
    SELECT
      ${dim} AS key,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'lead_created')::int AS leads,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${CONTACT}))::int AS contacted,
      count(DISTINCT e."leadId") FILTER (WHERE e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')::int AS replied,
      count(DISTINCT e."leadId") FILTER (
        WHERE (e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE}))
           OR (e.type = 'call_completed' AND e.properties->>'outcome' = ANY(${POSITIVE_CALL_OUTCOMES}))
      )::int AS positive,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'meeting_created')::int AS meetings,
      count(DISTINCT e."leadId") FILTER (WHERE e.type = 'deal_won')::int AS won,
      coalesce(sum(e.value) FILTER (WHERE e.type = 'deal_won'), 0)::float AS revenue,
      count(*) FILTER (WHERE e.type = 'email_sent')::int AS email_sent,
      count(*) FILTER (WHERE e.type = 'whatsapp_sent')::int AS whatsapp_sent
    FROM events e
    ${byEvent ? Prisma.empty : Prisma.sql`JOIN leads l ON l.id = e."leadId" AND l."deletedAt" IS NULL`}
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${byEvent ? Prisma.sql`AND ${dim} IS NOT NULL` : Prisma.empty}
      ${eventFilterSql(filters)}
    GROUP BY 1
    ORDER BY contacted DESC, leads DESC
    LIMIT ${limit}`;

  const campaigns = dimension === "campaign" && rows.length ? await ctx.db.campaign.findMany({ where: { id: { in: rows.map((row) => row.key!).filter(Boolean) } }, select: { id: true, name: true } }) : [];
  const names = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  return rows
    .filter((row) => row.key !== null && (row.leads > 0 || row.contacted > 0 || row.won > 0))
    .map((row) => {
      const key = row.key!;
      const label =
        dimension === "channel"
          ? (CHANNEL_LABELS[key as Channel] ?? key)
          : dimension === "campaign"
            ? (names.get(key) ?? "Deleted campaign")
            : dimension === "category"
              ? (getCategory(key)?.label ?? key.replace(/_/g, " "))
              : dimension === "source"
                ? (SOURCE_LABELS[key] ?? key)
                : dimension === "fit"
                  ? ({ HIGH: "High fit", MEDIUM: "Medium fit", LOW: "Low fit" } as Record<string, string>)[key] ?? key
                  : key;
      const cost = byEvent ? Math.round(usdTo(currency, row.email_sent * CHANNEL_UNIT_COST_USD.EMAIL + row.whatsapp_sent * CHANNEL_UNIT_COST_USD.WHATSAPP) * 100) / 100 : undefined;
      return {
        key,
        label,
        leads: row.leads,
        contacted: row.contacted,
        replied: row.replied,
        positive: row.positive,
        meetings: row.meetings,
        won: row.won,
        revenue: row.revenue,
        replyRate: ratio(row.replied, row.contacted),
        positiveRate: ratio(row.positive, row.contacted),
        meetingRate: ratio(row.meetings, row.contacted),
        ...(cost !== undefined ? { cost } : {}),
      };
    });
}

// ----------------------------------------------------------------------------- Engagement timing

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When prospects reply: weekday × hour in the workspace timezone. */
export async function replyHeatmap(ctx: TenantContext, filters: ResolvedFilters, timezone: string) {
  const rows = await ctx.db.$queryRaw<Array<{ dow: number; hour: number; count: number }>>`
    SELECT extract(isodow FROM e."occurredAt" AT TIME ZONE ${timezone})::int AS dow,
           extract(hour FROM e."occurredAt" AT TIME ZONE ${timezone})::int AS hour,
           count(*)::int AS count
    FROM events e
    WHERE e."organizationId" = ${ctx.organizationId}::uuid
      AND e.type::text = ANY(${REPLY_TYPES})
      AND e."occurredAt" >= ${filters.from} AND e."occurredAt" < ${filters.to}
      ${eventFilterSql(filters)}
    GROUP BY 1, 2`;
  const values = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  for (const row of rows) values[row.dow - 1]![row.hour] = row.count;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const peak = rows.reduce<{ dow: number; hour: number; count: number } | null>((best, row) => (!best || row.count > best.count ? row : best), null);
  return { rows: WEEKDAYS, columns: Array.from({ length: 24 }, (_, hour) => String(hour)), values, total, peak: peak ? { day: WEEKDAYS[peak.dow - 1]!, hour: peak.hour, count: peak.count } : null };
}

/**
 * Replies by sequence step: each replying lead is credited to the last campaign step it
 * received before its first reply.
 */
export async function stepPerformance(ctx: TenantContext, filters: ResolvedFilters) {
  const lead = leadClauses(filters);
  const rows = await ctx.db.$queryRaw<Array<{ step: number; sent: number; replied: number }>>`
    WITH sends AS (
      SELECT m."leadId", s."order" AS step, min(m."sentAt") AS sent_at
      FROM messages m
      JOIN campaign_steps s ON s.id = m."campaignStepId"
      ${lead.length ? Prisma.sql`JOIN leads l ON l.id = m."leadId" AND ${Prisma.join(lead, " AND ")}` : Prisma.empty}
      WHERE m."organizationId" = ${ctx.organizationId}::uuid
        AND m.direction = 'OUTBOUND' AND m."sentAt" IS NOT NULL
        AND m."sentAt" >= ${filters.from} AND m."sentAt" < ${filters.to}
        ${filters.campaignId ? Prisma.sql`AND s."campaignId" = ${filters.campaignId}::uuid` : Prisma.empty}
        ${filters.channel ? Prisma.sql`AND m.channel = ${filters.channel}::"Channel"` : Prisma.empty}
      GROUP BY 1, 2
    ),
    first_reply AS (
      SELECT m."leadId", min(m."createdAt") AS at
      FROM messages m
      WHERE m."organizationId" = ${ctx.organizationId}::uuid AND m.direction = 'INBOUND'
      GROUP BY 1
    ),
    credited AS (
      SELECT s."leadId", max(s.step) AS step
      FROM sends s JOIN first_reply r ON r."leadId" = s."leadId" AND s.sent_at <= r.at
      GROUP BY 1
    )
    SELECT s.step,
           count(DISTINCT s."leadId")::int AS sent,
           count(DISTINCT c."leadId")::int AS replied
    FROM sends s
    LEFT JOIN credited c ON c."leadId" = s."leadId" AND c.step = s.step
    GROUP BY 1 ORDER BY 1`;
  // Step order is zero-based: 0 is the first message.
  return rows.map((row) => ({ step: row.step + 1, label: row.step === 0 ? "First message" : `Follow-up ${row.step}`, sent: row.sent, replied: row.replied, replyRate: ratio(row.replied, row.sent) }));
}

// ----------------------------------------------------------------------------- Cohorts

export const COHORT_MILESTONES = ["replied", "positive", "meeting", "won"] as const;
export type CohortMilestone = (typeof COHORT_MILESTONES)[number];

/**
 * Weekly cohorts of leads by the week they were first contacted: the share that reached a
 * milestone within N weeks of first contact. Cells that can't be observed yet are null.
 */
export async function contactCohorts(ctx: TenantContext, filters: ResolvedFilters, milestone: CohortMilestone, timezone: string, weeks = 8) {
  const lead = leadClauses(filters);
  const milestoneFilter =
    milestone === "replied"
      ? Prisma.sql`(e.type::text = ANY(${REPLY_TYPES}) OR e.type = 'call_answered')`
      : milestone === "positive"
        ? Prisma.sql`((e.type = 'reply_classified' AND e.properties->>'intent' = ANY(${POSITIVE})) OR (e.type = 'call_completed' AND e.properties->>'outcome' = ANY(${POSITIVE_CALL_OUTCOMES})))`
        : milestone === "meeting"
          ? Prisma.sql`e.type = 'meeting_created'`
          : Prisma.sql`e.type = 'deal_won'`;
  const since = new Date(filters.to.getTime() - weeks * 7 * 86_400_000);
  const rows = await ctx.db.$queryRaw<Array<{ week: string; size: number; offsets: number[] }>>`
    WITH first_contact AS (
      SELECT e."leadId", min(e."occurredAt") AS at
      FROM events e
      ${lead.length ? Prisma.sql`JOIN leads l ON l.id = e."leadId" AND ${Prisma.join(lead, " AND ")}` : Prisma.empty}
      WHERE e."organizationId" = ${ctx.organizationId}::uuid AND e.type::text = ANY(${CONTACT})
        ${filters.campaignId ? Prisma.sql`AND e."campaignId" = ${filters.campaignId}::uuid` : Prisma.empty}
        ${filters.channel ? Prisma.sql`AND e.channel = ${filters.channel}::"Channel"` : Prisma.empty}
      GROUP BY 1
    ),
    reached AS (
      SELECT e."leadId", min(e."occurredAt") AS at
      FROM events e
      WHERE e."organizationId" = ${ctx.organizationId}::uuid AND ${milestoneFilter}
      GROUP BY 1
    )
    SELECT to_char(date_trunc('week', f.at AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS week,
           count(*)::int AS size,
           array_remove(array_agg(CASE WHEN r.at >= f.at THEN floor(extract(epoch FROM r.at - f.at) / 604800)::int END), NULL) AS offsets
    FROM first_contact f
    LEFT JOIN reached r ON r."leadId" = f."leadId"
    WHERE f.at >= ${since} AND f.at < ${filters.to}
    GROUP BY 1 ORDER BY 1`;
  const now = filters.to.getTime();
  return rows.map((row) => {
    const start = new Date(`${row.week}T00:00:00Z`).getTime();
    const cells = Array.from({ length: weeks }, (_, offset) => {
      // A week-N cell is only final once N+1 weeks have passed since the cohort started.
      if (start + (offset + 1) * 7 * 86_400_000 > now + 7 * 86_400_000) return null;
      const reachedBy = row.offsets.filter((value) => value <= offset).length;
      return row.size ? reachedBy / row.size : null;
    });
    return { week: row.week, size: row.size, cells };
  });
}

// ----------------------------------------------------------------------------- Loss reasons & quality

export async function lossReasons(ctx: TenantContext, filters: ResolvedFilters) {
  const lead = leadClauses(filters);
  const [deals, objections] = await Promise.all([
    ctx.db.$queryRaw<Array<{ reason: string; count: number; value: number }>>`
      SELECT coalesce(nullif(d."lostReason", ''), 'Not recorded') AS reason, count(*)::int AS count, coalesce(sum(d.value), 0)::float AS value
      FROM deals d
      ${lead.length ? Prisma.sql`JOIN leads l ON l.id = d."leadId" AND ${Prisma.join(lead, " AND ")}` : Prisma.empty}
      WHERE d."organizationId" = ${ctx.organizationId}::uuid AND d."deletedAt" IS NULL AND d.stage = 'LOST'
        AND d."lostAt" >= ${filters.from} AND d."lostAt" < ${filters.to}
        ${filters.campaignId ? Prisma.sql`AND d."campaignId" = ${filters.campaignId}::uuid` : Prisma.empty}
      GROUP BY 1 ORDER BY 2 DESC`,
    ctx.db.$queryRaw<Array<{ objection: string }>>`
      SELECT jsonb_array_elements_text(c.metadata->'analysis'->'objections') AS objection
      FROM calls c
      ${lead.length ? Prisma.sql`JOIN leads l ON l.id = c."leadId" AND ${Prisma.join(lead, " AND ")}` : Prisma.empty}
      WHERE c."organizationId" = ${ctx.organizationId}::uuid AND c."createdAt" >= ${filters.from} AND c."createdAt" < ${filters.to}
        AND jsonb_typeof(c.metadata->'analysis'->'objections') = 'array'
        ${filters.campaignId ? Prisma.sql`AND c."campaignId" = ${filters.campaignId}::uuid` : Prisma.empty}`,
  ]);
  const themes: Array<[string, RegExp]> = [
    ["Price / budget", /price|pric|cost|budget|expensive|afford|cheap/i],
    ["Timing", /time|later|busy|month|season|not now|next/i],
    ["Already has a provider", /agency|freelanc|already|in-house|vendor|provider|team/i],
    ["Needs more information", /detail|info|example|case stud|portfolio|proof/i],
    ["Not a fit", /not (a )?fit|don't need|do not need|no need|not interested/i],
  ];
  const counts = new Map<string, number>();
  for (const row of objections) {
    const theme = themes.find(([, pattern]) => pattern.test(row.objection))?.[0] ?? "Other";
    counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return {
    deals: deals.map((row) => ({ reason: row.reason, count: row.count, value: row.value })),
    objections: [...counts.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count),
  };
}

async function quality(ctx: TenantContext, filters: ResolvedFilters) {
  const lead = leadClauses(filters, "leads");
  const where = Prisma.sql`"organizationId" = ${ctx.organizationId}::uuid AND "deletedAt" IS NULL ${lead.length ? Prisma.sql`AND ${Prisma.join(lead, " AND ")}` : Prisma.empty}`;
  const [scores, tiers, sources] = await Promise.all([
    ctx.db.$queryRaw<Array<{ band: string; count: number }>>`
      SELECT CASE WHEN score IS NULL THEN 'Unscored' WHEN score >= 80 THEN '80–100' WHEN score >= 60 THEN '60–79' WHEN score >= 40 THEN '40–59' WHEN score >= 20 THEN '20–39' ELSE '0–19' END AS band, count(*)::int AS count
      FROM leads WHERE ${where} GROUP BY 1`,
    ctx.db.$queryRaw<Array<{ tier: string; count: number }>>`
      SELECT coalesce("fitTier"::text, 'Unscored') AS tier, count(*)::int AS count FROM leads WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
    ctx.db.$queryRaw<Array<{ source: string; count: number }>>`
      SELECT "sourceProvider" AS source, count(*)::int AS count FROM leads WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
  ]);
  const order = ["0–19", "20–39", "40–59", "60–79", "80–100"];
  const byBand = new Map(scores.map((row) => [row.band, row.count]));
  return {
    scores: order.map((band) => ({ band, count: byBand.get(band) ?? 0 })),
    unscored: byBand.get("Unscored") ?? 0,
    tiers: tiers.map((row) => ({ label: ({ HIGH: "High fit", MEDIUM: "Medium fit", LOW: "Low fit" } as Record<string, string>)[row.tier] ?? row.tier, count: row.count })),
    sources: sources.map((row) => ({ label: SOURCE_LABELS[row.source] ?? row.source, count: row.count })),
  };
}

const AGENT_LABELS: Record<string, string> = {
  business_understanding: "Business analysis",
  discovery_parser: "Discovery search",
  lead_qualification: "Lead qualification",
  outreach_message: "Outreach writing",
  outreach_email: "Outreach writing",
  conversation_analysis: "Reply analysis",
  call_brief: "Call briefs",
  voice_turn: "Voice conversations",
  call_analysis: "Call analysis",
  quote_draft: "Quote drafts",
  copilot: "Copilot",
  insight_writer: "Insight writing",
};

async function aiSpend(ctx: TenantContext, filters: ResolvedFilters, currency: string) {
  const campaign = filters.campaignId ? Prisma.sql`AND "campaignId" = ${filters.campaignId}::uuid` : Prisma.empty;
  const rows = await ctx.db.$queryRaw<Array<{ agent: string; requests: number; cached: number; micro: number; tokens: number }>>`
    SELECT agent, count(*)::int AS requests, count(*) FILTER (WHERE status = 'CACHED')::int AS cached,
           coalesce(sum("costMicroUsd"), 0)::float AS micro, coalesce(sum("inputTokens" + "outputTokens"), 0)::float AS tokens
    FROM ai_requests
    WHERE "organizationId" = ${ctx.organizationId}::uuid AND "createdAt" >= ${filters.from} AND "createdAt" < ${filters.to}
      ${campaign} ${leadExists(filters, Prisma.sql`ai_requests."leadId"`)}
    GROUP BY 1 ORDER BY 4 DESC, 2 DESC`;
  const totalRequests = rows.reduce((sum, row) => sum + row.requests, 0);
  return {
    totalRequests,
    cacheHitRate: ratio(rows.reduce((sum, row) => sum + row.cached, 0), totalRequests),
    agents: rows.map((row) => ({
      agent: row.agent,
      label: AGENT_LABELS[row.agent] ?? row.agent.replace(/_/g, " "),
      requests: row.requests,
      cached: row.cached,
      tokens: row.tokens,
      costUsd: row.micro / 1_000_000,
      cost: Math.round(usdTo(currency, row.micro / 1_000_000) * 100) / 100,
    })),
  };
}

// ----------------------------------------------------------------------------- Report

export async function getAnalyticsReport(ctx: TenantContext, input: AnalyticsFilterInput = {}) {
  assertCan(ctx, "analytics:read");
  const filters = resolveFilters(input);
  const [org, plan] = await Promise.all([ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true, currency: true } }), resolvePlan(ctx)]);
  const { timezone, currency } = org;
  const advanced = Boolean(plan.features.advancedAnalytics);

  const [now, before, trend, steps] = await Promise.all([counts(ctx, filters.from, filters.to, filters), counts(ctx, filters.previousFrom, filters.previousTo, filters), series(ctx, filters, timezone), funnel(ctx, filters)]);
  const planRow = await ctx.db.plan.findUnique({ where: { id: plan.id }, select: { priceMonthly: true, currency: true } });
  const price = { priceMonthly: planRow?.priceMonthly ?? 0, currency: planRow?.currency ?? "USD" };
  const [costNow, costBefore] = await Promise.all([costs(ctx, filters.from, filters.to, filters, currency, now, price), costs(ctx, filters.previousFrom, filters.previousTo, filters, currency, before, price)]);
  const groups = metricGroups(now, before, costNow, costBefore);

  const basic = {
    range: { from: filters.from.toISOString(), to: filters.to.toISOString(), previousFrom: filters.previousFrom.toISOString(), previousTo: filters.previousTo.toISOString(), days: filters.days },
    currency,
    timezone,
    advanced,
    // Costs can't be split by channel for AI usage; say so when a channel filter is on.
    notes: [
      "Rates are per contacted lead; counts are events in the period.",
      `AI and channel costs are estimates in ${currency}${currency !== "USD" ? " converted from USD" : ""}.`,
      ...(filters.channel ? ["AI cost includes all channels — it can't be attributed to one."] : []),
      ...(hasLeadFilters(filters) ? ["AI cost counts requests tied to the filtered leads only."] : []),
    ],
    groups: advanced ? groups : groups.filter((group) => group.key !== "efficiency").map((group) => ({ ...group, metrics: group.metrics.filter((metric) => !metric.key.startsWith("cost")) })),
    costs: advanced ? costNow : null,
    series: trend,
    funnel: steps,
  };
  if (!advanced) return { ...basic, channels: await breakdown(ctx, filters, "channel", currency), detail: null };

  const [channels, campaigns, heatmap, followUps, cohorts, losses, leadQuality, ai] = await Promise.all([
    breakdown(ctx, filters, "channel", currency),
    breakdown(ctx, filters, "campaign", currency),
    replyHeatmap(ctx, filters, timezone),
    stepPerformance(ctx, filters),
    contactCohorts(ctx, filters, "replied", timezone),
    lossReasons(ctx, filters),
    quality(ctx, filters),
    aiSpend(ctx, filters, currency),
  ]);
  return { ...basic, channels, detail: { campaigns, heatmap, followUps, cohorts, losses, quality: leadQuality, ai } };
}
export type AnalyticsReport = Awaited<ReturnType<typeof getAnalyticsReport>>;

export async function getBreakdown(ctx: TenantContext, input: AnalyticsFilterInput, dimension: BreakdownDimension) {
  assertCan(ctx, "analytics:read");
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true } });
  return breakdown(ctx, resolveFilters(input), dimension, org.currency);
}

export async function getCohorts(ctx: TenantContext, input: AnalyticsFilterInput, milestone: CohortMilestone) {
  assertCan(ctx, "analytics:read");
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
  return contactCohorts(ctx, resolveFilters(input), milestone, org.timezone);
}

// ----------------------------------------------------------------------------- CSV export

export const EXPORT_DATASETS = ["metrics", "series", "funnel", ...BREAKDOWN_DIMENSIONS.map((dimension) => `breakdown-${dimension}` as const)] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(Math.round(value * 10_000) / 10_000) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** The numbers behind a view, as CSV (rates as fractions, money in the workspace currency). */
export async function exportAnalyticsCsv(ctx: TenantContext, input: AnalyticsFilterInput, dataset: ExportDataset): Promise<{ filename: string; csv: string }> {
  assertCan(ctx, "analytics:read");
  const filters = resolveFilters(input);
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true, currency: true } });
  const stamp = `${filters.from.toISOString().slice(0, 10)}_${filters.to.toISOString().slice(0, 10)}`;
  if (dataset === "series") {
    const { points } = await series(ctx, filters, org.timezone);
    return { filename: `activity_${stamp}.csv`, csv: toCsv(["date", "leads", "outreach", "replies", "positive", "meetings", "won", `revenue_${org.currency}`], points.map((p) => [p.date, p.leads, p.outreach, p.replies, p.positive, p.meetings, p.won, p.revenue])) };
  }
  if (dataset === "funnel") {
    const steps = await funnel(ctx, filters);
    return { filename: `funnel_${stamp}.csv`, csv: toCsv(["stage", "leads", "conversion_from_previous"], steps.map((step, index) => [step.label, step.value, index ? ratio(step.value, steps[index - 1]!.value) : null])) };
  }
  if (dataset === "metrics") {
    const report = await getAnalyticsReport(ctx, input);
    const rows = report.groups.flatMap((group) => group.metrics.map((metric) => [group.label, metric.label, metric.value, metric.previous, metric.format, metric.numerator ?? null, metric.denominator ?? null, metric.definition]));
    return { filename: `metrics_${stamp}.csv`, csv: toCsv(["group", "metric", "value", "previous_period", "format", "numerator", "denominator", "definition"], rows) };
  }
  const dimension = dataset.replace("breakdown-", "") as BreakdownDimension;
  const rows = await breakdown(ctx, filters, dimension, org.currency, 200);
  return {
    filename: `breakdown_${dimension}_${stamp}.csv`,
    csv: toCsv([dimension, "leads", "contacted", "replied", "positive", "meetings", "won", `revenue_${org.currency}`, "reply_rate", "positive_rate", "meeting_rate"], rows.map((row) => [row.label, row.leads, row.contacted, row.replied, row.positive, row.meetings, row.won, row.revenue, row.replyRate, row.positiveRate, row.meetingRate])),
  };
}
