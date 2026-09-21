import { POSITIVE_INTENTS } from "@repo/config";
import type { TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { ratio } from "../analytics/filters";

/** Campaign performance computed from the event log and current campaign-lead states. */
export async function getCampaignStats(ctx: TenantContext, campaignId: string) {
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null }, select: { id: true, launchedAt: true, createdAt: true, completedAt: true } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  const positive = [...POSITIVE_INTENTS];
  // Daily series from launch (max 90 days) to completion or today, zero-filled.
  const seriesEnd = campaign.completedAt ?? new Date();
  const seriesStart = new Date(Math.max((campaign.launchedAt ?? campaign.createdAt).getTime(), seriesEnd.getTime() - 89 * 86_400_000));

  const [membership, counts, pendingApproval, series, channels, stepRows] = await Promise.all([
    ctx.db.campaignLead.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } }),
    ctx.db.$queryRaw<Array<Record<string, number>>>`
      SELECT
        count(*) FILTER (WHERE type IN ('email_sent', 'whatsapp_sent'))::int AS sent,
        count(*) FILTER (WHERE type IN ('email_delivered', 'whatsapp_delivered'))::int AS delivered,
        count(*) FILTER (WHERE type IN ('email_opened', 'whatsapp_read'))::int AS opened,
        count(*) FILTER (WHERE type IN ('email_replied', 'whatsapp_received'))::int AS replies,
        count(*) FILTER (WHERE type = 'reply_classified' AND properties->>'intent' = ANY(${positive}))::int AS positive,
        count(*) FILTER (WHERE type IN ('email_bounced', 'email_failed', 'whatsapp_failed'))::int AS failed,
        count(*) FILTER (WHERE type IN ('opt_out', 'email_unsubscribed'))::int AS opt_outs,
        count(*) FILTER (WHERE type = 'call_completed')::int AS calls,
        count(*) FILTER (WHERE type = 'meeting_created')::int AS meetings,
        count(*) FILTER (WHERE type = 'deal_won')::int AS won,
        coalesce(sum(value) FILTER (WHERE type = 'deal_won'), 0)::float AS revenue,
        count(DISTINCT "leadId") FILTER (WHERE type IN ('email_sent', 'whatsapp_sent', 'call_completed'))::int AS leads_contacted,
        count(DISTINCT "leadId") FILTER (WHERE type IN ('email_opened', 'whatsapp_read'))::int AS leads_opened,
        count(DISTINCT "leadId") FILTER (WHERE type IN ('email_replied', 'whatsapp_received', 'call_answered'))::int AS leads_replied,
        count(DISTINCT "leadId") FILTER (WHERE type = 'reply_classified' AND properties->>'intent' = ANY(${positive}))::int AS leads_positive,
        count(DISTINCT "leadId") FILTER (WHERE type = 'meeting_created')::int AS leads_meeting
      FROM events
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "campaignId" = ${campaignId}::uuid`,
    ctx.db.message.count({ where: { campaignId, status: { in: ["PENDING_APPROVAL", "DRAFT"] } } }),
    ctx.db.$queryRaw<Array<{ day: string; sent: number; replies: number }>>`
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        count(events.id) FILTER (WHERE events.type IN ('email_sent', 'whatsapp_sent'))::int AS sent,
        count(events.id) FILTER (WHERE events.type IN ('email_replied', 'whatsapp_received'))::int AS replies
      FROM generate_series(date_trunc('day', ${seriesStart}::timestamptz), date_trunc('day', ${seriesEnd}::timestamptz), interval '1 day') AS days(day)
      LEFT JOIN events
        ON events."organizationId" = ${ctx.organizationId}::uuid AND events."campaignId" = ${campaignId}::uuid
        AND events."occurredAt" >= days.day AND events."occurredAt" < days.day + interval '1 day'
      GROUP BY days.day ORDER BY days.day`,
    ctx.db.$queryRaw<Array<{ channel: string; sent: number; replies: number }>>`
      SELECT channel::text AS channel,
        count(*) FILTER (WHERE type IN ('email_sent', 'whatsapp_sent', 'call_completed'))::int AS sent,
        count(*) FILTER (WHERE type IN ('email_replied', 'whatsapp_received', 'call_answered'))::int AS replies
      FROM events
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "campaignId" = ${campaignId}::uuid AND channel IS NOT NULL
      GROUP BY 1`,
    ctx.db.message.groupBy({ by: ["campaignStepId", "status"], where: { campaignId, direction: "OUTBOUND", campaignStepId: { not: null } }, _count: { _all: true } }),
  ]);
  const steps: Record<string, { sent: number; pending: number; scheduled: number; failed: number }> = {};
  for (const row of stepRows) {
    if (!row.campaignStepId) continue;
    const entry = (steps[row.campaignStepId] ??= { sent: 0, pending: 0, scheduled: 0, failed: 0 });
    const count = row._count._all;
    if (["SENT", "DELIVERED", "READ"].includes(row.status)) entry.sent += count;
    else if (["DRAFT", "PENDING_APPROVAL"].includes(row.status)) entry.pending += count;
    else if (["APPROVED", "QUEUED", "SENDING"].includes(row.status)) entry.scheduled += count;
    else if (["FAILED", "BOUNCED", "SUPPRESSED"].includes(row.status)) entry.failed += count;
  }
  const totals = counts[0] ?? {};
  const byStatus = Object.fromEntries(membership.map((row) => [row.status, row._count._all]));
  const audience = membership.reduce((sum, row) => sum + row._count._all, 0);
  const sent = totals.sent ?? 0;
  // Engagement rates are per lead contacted (industry convention); delivery is per message.
  const leads = {
    contacted: totals.leads_contacted ?? 0,
    opened: totals.leads_opened ?? 0,
    replied: totals.leads_replied ?? 0,
    positive: totals.leads_positive ?? 0,
    meetings: totals.leads_meeting ?? 0,
  };
  return {
    audience,
    byStatus,
    pendingApproval,
    leads,
    sent,
    delivered: totals.delivered ?? 0,
    opened: totals.opened ?? 0,
    replies: totals.replies ?? 0,
    positive: totals.positive ?? 0,
    failed: totals.failed ?? 0,
    optOuts: totals.opt_outs ?? 0,
    calls: totals.calls ?? 0,
    meetings: totals.meetings ?? 0,
    won: totals.won ?? 0,
    revenue: totals.revenue ?? 0,
    rates: {
      delivery: ratio(totals.delivered ?? 0, sent),
      open: ratio(leads.opened, leads.contacted),
      reply: ratio(leads.replied, leads.contacted),
      positive: ratio(leads.positive, leads.contacted),
    },
    series,
    channels,
    steps,
  };
}

export type CampaignStats = Awaited<ReturnType<typeof getCampaignStats>>;

/** Campaigns list with lightweight stats for cards. */
export async function listCampaignsWithStats(ctx: TenantContext) {
  const campaigns = await ctx.db.campaign.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  if (!campaigns.length) return [];
  const ids = campaigns.map((campaign) => campaign.id);
  const [members, events] = await Promise.all([
    ctx.db.campaignLead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: { _all: true } }),
    ctx.db.$queryRaw<Array<{ campaign_id: string; sent: number; replies: number; positive: number; meetings: number; contacted: number; replied_leads: number }>>`
      SELECT "campaignId" AS campaign_id,
        count(*) FILTER (WHERE type IN ('email_sent', 'whatsapp_sent', 'call_completed'))::int AS sent,
        count(*) FILTER (WHERE type IN ('email_replied', 'whatsapp_received'))::int AS replies,
        count(DISTINCT "leadId") FILTER (WHERE type IN ('email_sent', 'whatsapp_sent', 'call_completed'))::int AS contacted,
        count(DISTINCT "leadId") FILTER (WHERE type IN ('email_replied', 'whatsapp_received'))::int AS replied_leads,
        count(*) FILTER (WHERE type = 'reply_classified' AND properties->>'intent' = ANY(${[...POSITIVE_INTENTS]}))::int AS positive,
        count(*) FILTER (WHERE type = 'meeting_created')::int AS meetings
      FROM events
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "campaignId" = ANY(${ids}::uuid[])
      GROUP BY 1`,
  ]);
  const audience = new Map(members.map((row) => [row.campaignId, row._count._all]));
  const stats = new Map(events.map((row) => [row.campaign_id, row]));
  return campaigns.map((campaign) => {
    const row = stats.get(campaign.id);
    return {
      ...campaign,
      audience: audience.get(campaign.id) ?? 0,
      sent: row?.sent ?? 0,
      replies: row?.replies ?? 0,
      positive: row?.positive ?? 0,
      meetings: row?.meetings ?? 0,
      contacted: row?.contacted ?? 0,
      repliedLeads: row?.replied_leads ?? 0,
      replyRate: ratio(row?.replied_leads ?? 0, row?.contacted ?? 0),
    };
  });
}
