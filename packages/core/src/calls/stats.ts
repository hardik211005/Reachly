import { ratio } from "../analytics/filters";
import { assertCan, type TenantContext } from "../context";

/** Calls dashboard numbers, from call records and meetings created by calls. */
export async function callsOverview(ctx: TenantContext, days = 30) {
  assertCan(ctx, "conversations:read");
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { startedAt: { gte: since } };
  const [totals, outcomes, meetings, series, queue, live] = await Promise.all([
    ctx.db.$queryRaw<Array<{ placed: number; connected: number; unreached: number; failed: number; avg_seconds: number | null; minutes: number; cost_cents: number }>>`
      SELECT
        count(*)::int AS placed,
        count(*) FILTER (WHERE "answeredAt" IS NOT NULL)::int AS connected,
        count(*) FILTER (WHERE status IN ('NO_ANSWER', 'BUSY'))::int AS unreached,
        count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
        avg("durationSeconds") FILTER (WHERE "answeredAt" IS NOT NULL AND status = 'COMPLETED')::float AS avg_seconds,
        coalesce(sum(ceil("durationSeconds" / 60.0)) FILTER (WHERE status = 'COMPLETED' AND type = 'AI_AGENT'), 0)::int AS minutes,
        coalesce(sum("costCents"), 0)::int AS cost_cents
      FROM calls
      WHERE "organizationId" = ${ctx.organizationId}::uuid AND "startedAt" >= ${since}`,
    ctx.db.call.groupBy({ by: ["outcome"], where: { ...where, outcome: { not: null } }, _count: { _all: true } }),
    ctx.db.meeting.count({ where: { source: "call", createdAt: { gte: since } } }),
    ctx.db.$queryRaw<Array<{ day: string; placed: number; connected: number }>>`
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        count(calls.id)::int AS placed,
        count(calls.id) FILTER (WHERE calls."answeredAt" IS NOT NULL)::int AS connected
      FROM generate_series(date_trunc('day', ${since}::timestamptz), date_trunc('day', now()), interval '1 day') AS days(day)
      LEFT JOIN calls
        ON calls."organizationId" = ${ctx.organizationId}::uuid
        AND calls."startedAt" >= days.day AND calls."startedAt" < days.day + interval '1 day'
      GROUP BY days.day ORDER BY days.day`,
    ctx.db.call.count({ where: { status: { in: ["PREPARED", "QUEUED"] } } }),
    ctx.db.call.count({ where: { status: { in: ["RINGING", "IN_PROGRESS"] } } }),
  ]);
  const row = totals[0] ?? { placed: 0, connected: 0, unreached: 0, failed: 0, avg_seconds: null, minutes: 0, cost_cents: 0 };
  const positive = outcomes.filter((item) => item.outcome && ["INTERESTED", "MEETING_REQUESTED", "NEEDS_INFORMATION"].includes(item.outcome)).reduce((sum, item) => sum + item._count._all, 0);
  return {
    days,
    placed: row.placed,
    connected: row.connected,
    unreached: row.unreached,
    failed: row.failed,
    connectRate: ratio(row.connected, row.placed),
    positiveRate: ratio(positive, row.connected),
    avgDurationSeconds: row.avg_seconds === null ? null : Math.round(row.avg_seconds),
    minutes: row.minutes,
    costUsd: row.cost_cents / 100,
    meetings,
    outcomes: outcomes.filter((item) => item.outcome).map((item) => ({ outcome: item.outcome as string, count: item._count._all })),
    series,
    queue,
    live,
  };
}
