import { USAGE_METRICS, USAGE_METRIC_LABELS, type UsageMetric } from "@repo/config";

import type { TenantContext } from "../context";
import { LimitExceededError } from "../errors";
import { notify } from "../notifications";
import { currentBillingPeriod } from "../shared/dates";
import { resolvePlan } from "./plans";

/**
 * Metered usage. Limits are enforced server-side with an atomic conditional UPDATE so
 * concurrent workers can never push an organisation past its allowance.
 */

export interface UsageSnapshot {
  metric: UsageMetric;
  label: string;
  unit: string;
  used: number;
  /** Plan allowance + credit grants; null = unlimited. */
  limit: number | null;
  remaining: number | null;
  percent: number | null;
}

export interface ConsumeOptions {
  sourceType: string;
  sourceId?: string | null;
  campaignId?: string | null;
  /** Consuming twice with the same key is a no-op (job retries, webhook replays). */
  idempotencyKey?: string;
}

async function periodFor(ctx: TenantContext): Promise<{ start: Date; end: Date; limits: Record<UsageMetric, number | null>; planName: string }> {
  const plan = await resolvePlan(ctx);
  const period = currentBillingPeriod(plan.subscription.currentPeriodStart);
  return { ...period, limits: plan.limits.usage, planName: plan.name };
}

async function grantsFor(ctx: TenantContext, periodStart: Date): Promise<Map<UsageMetric, number>> {
  const grants = await ctx.db.creditGrant.groupBy({
    by: ["metric"],
    where: { periodStart },
    _sum: { amount: true },
  });
  return new Map(grants.map((grant) => [grant.metric, grant._sum.amount ?? 0]));
}

function effectiveLimit(base: number | null, granted: number): number | null {
  return base === null ? null : base + granted;
}

export async function getUsage(ctx: TenantContext): Promise<{ periodStart: Date; periodEnd: Date; metrics: UsageSnapshot[] }> {
  const period = await periodFor(ctx);
  const [counters, grants] = await Promise.all([
    ctx.db.usageCounter.findMany({ where: { periodStart: period.start } }),
    grantsFor(ctx, period.start),
  ]);
  const used = new Map(counters.map((counter) => [counter.metric, counter.used]));
  const metrics = USAGE_METRICS.map((metric): UsageSnapshot => {
    const limit = effectiveLimit(period.limits[metric], grants.get(metric) ?? 0);
    const value = used.get(metric) ?? 0;
    return {
      metric,
      label: USAGE_METRIC_LABELS[metric].label,
      unit: USAGE_METRIC_LABELS[metric].unit,
      used: value,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - value),
      percent: limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((value / limit) * 100)),
    };
  });
  return { periodStart: period.start, periodEnd: period.end, metrics };
}

/** Non-mutating check, e.g. for pre-launch estimates. */
export async function checkUsage(ctx: TenantContext, metric: UsageMetric, quantity: number): Promise<UsageSnapshot> {
  const usage = await getUsage(ctx);
  const snapshot = usage.metrics.find((item) => item.metric === metric);
  if (!snapshot) throw new Error(`Unknown metric ${metric}`);
  return snapshot.limit !== null && snapshot.used + quantity > snapshot.limit
    ? { ...snapshot, remaining: Math.max(0, snapshot.limit - snapshot.used) }
    : snapshot;
}

export async function consumeUsage(
  ctx: TenantContext,
  metric: UsageMetric,
  quantity: number,
  options: ConsumeOptions,
): Promise<{ used: number; limit: number | null; duplicate: boolean }> {
  if (quantity <= 0) return { used: 0, limit: null, duplicate: false };
  const period = await periodFor(ctx);
  const grants = await grantsFor(ctx, period.start);
  const limit = effectiveLimit(period.limits[metric], grants.get(metric) ?? 0);

  const result = await ctx.db.$transaction(async (tx) => {
    if (options.idempotencyKey) {
      const existing = await tx.usageRecord.findFirst({
        where: { organizationId: ctx.organizationId, idempotencyKey: options.idempotencyKey },
      });
      if (existing) return { used: -1, duplicate: true };
    }

    await tx.$executeRaw`
      INSERT INTO usage_counters (id, "organizationId", metric, "periodStart", used, "updatedAt")
      VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${metric}::"UsageMetric", ${period.start}, 0, now())
      ON CONFLICT ("organizationId", metric, "periodStart") DO NOTHING`;

    const rows = await tx.$queryRaw<Array<{ used: number }>>`
      UPDATE usage_counters
         SET used = used + ${quantity}, "updatedAt" = now()
       WHERE "organizationId" = ${ctx.organizationId}::uuid
         AND metric = ${metric}::"UsageMetric"
         AND "periodStart" = ${period.start}
         AND (${limit}::int IS NULL OR used + ${quantity} <= ${limit}::int)
      RETURNING used`;

    const row = rows[0];
    if (!row) {
      const current = await tx.usageCounter.findFirst({
        where: { organizationId: ctx.organizationId, metric, periodStart: period.start },
      });
      throw new LimitExceededError(
        `You've used your ${USAGE_METRIC_LABELS[metric].label.toLowerCase()} for this billing period on the ${period.planName} plan.`,
        { metric, limit, used: current?.used ?? 0, requested: quantity },
      );
    }

    await tx.usageRecord.create({
      data: {
        organizationId: ctx.organizationId,
        metric,
        quantity,
        periodStart: period.start,
        sourceType: options.sourceType,
        sourceId: options.sourceId ?? null,
        userId: ctx.userId,
        campaignId: options.campaignId ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
      },
    });
    return { used: row.used, duplicate: false };
  });

  if (result.duplicate) return { used: 0, limit, duplicate: true };

  if (limit !== null && limit > 0) {
    const before = (result.used - quantity) / limit;
    const after = result.used / limit;
    if (before < 0.8 && after >= 0.8) {
      await notify(ctx, {
        type: "credits.low",
        title: `${USAGE_METRIC_LABELS[metric].label} at ${Math.round(after * 100)}%`,
        body: `${result.used} of ${limit} ${USAGE_METRIC_LABELS[metric].unit} used this billing period.`,
        link: "/app/billing",
        metadata: { metric },
      });
    }
  }
  return { used: result.used, limit, duplicate: false };
}

/** Gives back usage consumed for an action that ultimately did not happen (e.g. a failed send). */
export async function releaseUsage(ctx: TenantContext, metric: UsageMetric, quantity: number, reason: string, sourceId?: string) {
  const period = await periodFor(ctx);
  await ctx.db.$transaction([
    ctx.db.usageCounter.updateMany({
      where: { metric, periodStart: period.start, used: { gte: quantity } },
      data: { used: { decrement: quantity } },
    }),
    ctx.db.usageRecord.create({
      data: {
        organizationId: ctx.organizationId,
        metric,
        quantity: -quantity,
        periodStart: period.start,
        sourceType: `release:${reason}`,
        sourceId: sourceId ?? null,
        userId: ctx.userId,
      },
    }),
  ]);
}

export function isLimitError(error: unknown): error is LimitExceededError {
  return error instanceof LimitExceededError;
}

