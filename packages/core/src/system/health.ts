import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { createRedisConnection, DEAD_LETTER_QUEUE, getQueue, type QueueStats } from "@repo/queue";
import { resolveAIRoute } from "../ai/service";
import { assertCan, type TenantContext } from "../context";
import { getProviderStatuses, type ProviderStatus } from "../integrations/status";
import { recentDeadLetters } from "../jobs/dead-letter";

/**
 * System health for workspace admins: platform checks (database, queue, workers) and this
 * workspace's recent failures. Failed-job details are filtered to the workspace so one
 * tenant never sees another's job data.
 */

export type CheckState = "ok" | "degraded" | "down" | "not_applicable";

export interface HealthCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  latencyMs?: number;
}

interface FailedJob {
  name: string;
  error: string;
  failedAt: string;
  attempts?: number;
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null; ms: number; error: string | null }> {
  const started = performance.now();
  try {
    const value = await work();
    return { value, ms: Math.round(performance.now() - started), error: null };
  } catch (error) {
    return { value: null, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  }
}

const orgOf = (data: unknown): string | null => (data && typeof data === "object" && "organizationId" in data ? String((data as { organizationId: unknown }).organizationId) : null);

async function redisDetails(organizationId: string) {
  const redis = createRedisConnection(getEnv().REDIS_URL);
  try {
    const ping = await timed(() => redis.ping());
    if (ping.error) return { ping, workers: [] as Array<{ id: string; at: string; queues: string[] }>, failed: [] as FailedJob[] };
    const keys = await redis.keys("reachai:worker:*");
    const workers = (await Promise.all(keys.map(async (key) => ({ key, raw: await redis.get(key) }))))
      .filter((entry) => entry.raw)
      .map((entry) => {
        const parsed = JSON.parse(entry.raw!) as { at: string; queues: string[] };
        return { id: entry.key.replace("reachai:worker:", ""), at: parsed.at, queues: parsed.queues };
      });
    const dead = await redis.lrange(`reachai:${DEAD_LETTER_QUEUE}`, 0, 199);
    const failed = dead
      .map((raw) => JSON.parse(raw) as { name: string; data: unknown; error: string; failedAt: string })
      .filter((entry) => orgOf(entry.data) === organizationId)
      .slice(0, 20)
      .map((entry) => ({ name: entry.name, error: entry.error, failedAt: entry.failedAt }));
    return { ping, workers, failed };
  } finally {
    redis.disconnect();
  }
}

export async function getSystemHealth(ctx: TenantContext) {
  assertCan(ctx, "system:read");
  const env = getEnv();
  const queue = getQueue();
  const since = new Date(Date.now() - 24 * 3600_000);

  const [database, stats, ai, providers, workflowFailures, deliveryFailures, messageFailures, webhookFailures] = await Promise.all([
    timed(() => prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`),
    timed(() => queue.stats()),
    resolveAIRoute(ctx).then(
      (route) => ({ provider: route.providerName, model: route.model, source: route.source }),
      () => null,
    ),
    getProviderStatuses(ctx),
    ctx.db.workflowExecution.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    ctx.db.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    ctx.db.message.count({ where: { status: { in: ["FAILED", "BOUNCED"] }, updatedAt: { gte: since } } }),
    prisma.webhookEvent.count({ where: { organizationId: ctx.organizationId, status: "FAILED", receivedAt: { gte: since } } }),
  ]);

  const checks: HealthCheck[] = [];
  checks.push(database.error ? { key: "database", label: "Database", state: "down", detail: database.error, latencyMs: database.ms } : { key: "database", label: "Database", state: database.ms > 500 ? "degraded" : "ok", detail: database.ms > 500 ? "Responding slowly" : "Connected", latencyMs: database.ms });

  let workers: Array<{ id: string; at: string; queues: string[] }> = [];
  let failedJobs: FailedJob[] = [];
  if (queue.kind === "bullmq") {
    const redis = await redisDetails(ctx.organizationId).catch((error: unknown) => ({ ping: { value: null, ms: 0, error: error instanceof Error ? error.message : String(error) }, workers: [], failed: [] }));
    checks.push(redis.ping.error ? { key: "redis", label: "Redis", state: "down", detail: redis.ping.error } : { key: "redis", label: "Redis", state: "ok", detail: "Connected", latencyMs: redis.ping.ms });
    workers = redis.workers;
    failedJobs = redis.failed;
    checks.push(workers.length ? { key: "workers", label: "Background workers", state: "ok", detail: `${workers.length} running` } : { key: "workers", label: "Background workers", state: "down", detail: "No worker has reported in the last 90 seconds. Start apps/worker." });
  } else {
    checks.push({ key: "workers", label: "Background workers", state: env.APP_ENV === "production" ? "degraded" : "ok", detail: "Jobs run inside the web process (inline queue driver)." });
    failedJobs = recentDeadLetters(100)
      .filter((entry) => orgOf(entry.data) === ctx.organizationId)
      .slice(0, 20)
      .map((entry) => ({ name: entry.name, error: entry.error, failedAt: entry.failedAt, attempts: entry.attempts }));
  }

  const queueStats: QueueStats[] = stats.value ?? [];
  const backlog = queueStats.reduce((sum, row) => sum + row.waiting + row.delayed, 0);
  checks.push(stats.error ? { key: "queue", label: "Job queue", state: "down", detail: stats.error } : { key: "queue", label: "Job queue", state: backlog > 1000 ? "degraded" : "ok", detail: backlog > 1000 ? `${backlog.toLocaleString()} jobs waiting` : `${backlog} waiting` });
  checks.push(ai ? { key: "ai", label: "AI provider", state: "ok", detail: ai.source === "mock" ? "Demo mode — simulated responses" : `${ai.provider} · ${ai.model}` } : { key: "ai", label: "AI provider", state: "down", detail: "No AI provider configured" });
  const failures = workflowFailures + deliveryFailures + messageFailures + webhookFailures;
  checks.push({ key: "failures", label: "Failures (24h)", state: failures === 0 ? "ok" : failures > 25 ? "degraded" : "ok", detail: failures === 0 ? "Nothing failed" : `${failures} in the last 24 hours` });

  const overall: CheckState = checks.some((check) => check.state === "down") ? "down" : checks.some((check) => check.state === "degraded") ? "degraded" : "ok";
  return {
    checkedAt: new Date().toISOString(),
    overall,
    checks,
    queue: { driver: queue.kind, stats: queueStats },
    workers,
    failedJobs,
    failures: { workflows: workflowFailures, webhookDeliveries: deliveryFailures, messages: messageFailures, inboundWebhooks: webhookFailures },
    providers: providers as ProviderStatus[],
    runtime: { environment: env.APP_ENV, demoMode: env.DEMO_MODE, node: process.version, uptimeSeconds: Math.round(process.uptime()) },
  };
}
export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;
