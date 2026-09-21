import { ratio } from "../analytics/filters";
import { assertCan, type TenantContext } from "../context";
import { channelAvailability } from "./providers";

const EVENT_TYPES = {
  EMAIL: { sent: "email_sent", delivered: "email_delivered", engaged: "email_opened", replied: "email_replied", failed: ["email_bounced", "email_failed"], optOut: ["email_unsubscribed", "opt_out"] },
  WHATSAPP: { sent: "whatsapp_sent", delivered: "whatsapp_delivered", engaged: "whatsapp_read", replied: "whatsapp_received", failed: ["whatsapp_failed"], optOut: ["opt_out"] },
} as const;

/** Channel dashboard numbers (email / WhatsApp), computed from the event log. */
export async function channelOverview(ctx: TenantContext, channel: "EMAIL" | "WHATSAPP", days = 30) {
  assertCan(ctx, "campaigns:read");
  const types = EVENT_TYPES[channel];
  const since = new Date(Date.now() - days * 86_400_000);
  const [availability, totals, series, suppressions, recent, pendingApproval, templates] = await Promise.all([
    channelAvailability(ctx),
    ctx.db.$queryRaw<Array<{ sent: number; delivered: number; engaged: number; replied: number; failed: number; opt_outs: number }>>`
      SELECT
        count(*) FILTER (WHERE type::text = ${types.sent})::int AS sent,
        count(*) FILTER (WHERE type::text = ${types.delivered})::int AS delivered,
        count(*) FILTER (WHERE type::text = ${types.engaged})::int AS engaged,
        count(*) FILTER (WHERE type::text = ${types.replied})::int AS replied,
        count(*) FILTER (WHERE type::text = ANY(${[...types.failed]}))::int AS failed,
        count(*) FILTER (WHERE type::text = ANY(${[...types.optOut]}) AND (channel IS NULL OR channel::text = ${channel}))::int AS opt_outs
      FROM events
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "occurredAt" >= ${since}`,
    ctx.db.$queryRaw<Array<{ day: string; sent: number; replied: number }>>`
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        count(events.id) FILTER (WHERE events.type::text = ${types.sent})::int AS sent,
        count(events.id) FILTER (WHERE events.type::text = ${types.replied})::int AS replied
      FROM generate_series(date_trunc('day', ${since}::timestamptz), date_trunc('day', now()), interval '1 day') AS days(day)
      LEFT JOIN events
        ON events."organizationId" = ${ctx.organizationId}::uuid
        AND events.type::text IN (${types.sent}, ${types.replied})
        AND events."occurredAt" >= days.day AND events."occurredAt" < days.day + interval '1 day'
      GROUP BY days.day ORDER BY days.day`,
    ctx.db.suppression.groupBy({
      by: ["reason"],
      where: channel === "EMAIL" ? { OR: [{ type: "EMAIL" }, { type: "DOMAIN" }, { type: "LEAD" }] } : { OR: [{ type: "PHONE" }, { type: "LEAD" }] },
      _count: { _all: true },
    }),
    ctx.db.conversation.findMany({
      where: { channel, lastMessageAt: { not: null }, lead: { deletedAt: null } },
      orderBy: { lastMessageAt: "desc" },
      take: 8,
      include: {
        lead: { select: { id: true, name: true, city: true, locality: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, status: true, subject: true, createdAt: true } },
      },
    }),
    ctx.db.message.count({ where: { channel, direction: "OUTBOUND", status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
    channel === "WHATSAPP" ? ctx.db.whatsAppTemplate.groupBy({ by: ["status"], _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const row = totals[0] ?? { sent: 0, delivered: 0, engaged: 0, replied: 0, failed: 0, opt_outs: 0 };
  return {
    channel,
    days,
    provider: availability[channel],
    totals: row,
    rates: {
      delivery: ratio(row.delivered, row.sent),
      engagement: ratio(row.engaged, row.sent),
      reply: ratio(row.replied, row.sent),
      failure: ratio(row.failed, row.sent),
    },
    series,
    suppressions: suppressions.map((item) => ({ reason: item.reason, count: item._count._all })),
    recent: recent.map(({ messages, ...conversation }) => ({ ...conversation, lastMessage: messages[0] ?? null })),
    pendingApproval,
    templates: Object.fromEntries(templates.map((item) => [item.status, item._count._all])) as Record<string, number>,
  };
}
