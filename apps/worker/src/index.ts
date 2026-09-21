import { hostname } from "node:os";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { getEnv } from "@repo/config/env";
import { hasProcessor, processJob, recordDeadLetter } from "@repo/core/jobs/index";
import { logger } from "@repo/core/logger";
import { disconnectPrisma } from "@repo/db";
import {
  BullMQDriver,
  DEAD_LETTER_QUEUE,
  JOBS,
  JOB_NAMES,
  createRedisConnection,
  getQueue,
  type QueueName,
} from "@repo/queue";

/**
 * Background worker: one BullMQ Worker per queue that has registered processors, all
 * dispatching to the shared registry in @repo/core. Non-retryable failures skip retries
 * (UnrecoverableError); final failures are pushed to a dead-letter list for inspection.
 * A heartbeat key lets the system health page confirm workers are alive.
 */

const env = getEnv();
if (env.QUEUE_DRIVER !== "bullmq") {
  logger.error("apps/worker requires QUEUE_DRIVER=bullmq (inline mode runs jobs inside the web process)");
  process.exit(1);
}

const CONCURRENCY: Partial<Record<QueueName, number>> = {
  discovery: 2,
  enrichment: 8,
  scoring: 8,
  outreach: 4,
  messaging: 8,
  voice: 4,
  webhooks: 10,
  events: 10,
  analytics: 2,
  demo: 4,
};

const workerId = `${hostname()}:${process.pid}`;
const log = logger.child({ service: "worker", workerId });
const connection = createRedisConnection(env.REDIS_URL);
const driver = getQueue();

const queues = [...new Set(JOB_NAMES.filter((name) => hasProcessor(name)).map((name) => JOBS[name].queue))];

async function deadLetter(job: Job, error: Error) {
  recordDeadLetter({ jobId: job.id ?? "unknown", name: job.name, error: error.message, attempts: job.attemptsMade, data: job.data });
  const entry = { queue: job.queueName, name: job.name, jobId: job.id, data: job.data, error: error.message, failedAt: new Date().toISOString() };
  await connection.lpush(`reachai:${DEAD_LETTER_QUEUE}`, JSON.stringify(entry));
  await connection.ltrim(`reachai:${DEAD_LETTER_QUEUE}`, 0, 999);
}

const workers = queues.map((queue) => {
  const worker = new Worker(
    queue,
    async (job) => {
      try {
        return await processJob(job.name, job.data, {
          jobId: job.id ?? "unknown",
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? 1,
        });
      } catch (error) {
        if ((error as { retryable?: boolean }).retryable === false) {
          throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    },
    { connection, concurrency: CONCURRENCY[queue] ?? 4 },
  );
  worker.on("failed", (job, error) => {
    if (!job) return;
    const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (final) void deadLetter(job, error).catch((err: unknown) => log.error({ err }, "dead-letter write failed"));
  });
  worker.on("error", (error) => log.error({ err: error, queue }, "worker error"));
  return worker;
});

if (driver instanceof BullMQDriver) await driver.upsertSchedules((job) => hasProcessor(job));

const beat = () => connection.set(`reachai:worker:${workerId}`, JSON.stringify({ at: new Date().toISOString(), queues }), "EX", 90);
await beat();
const heartbeat = setInterval(() => void beat(), 30_000);

log.info({ queues }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "worker shutting down");
  clearInterval(heartbeat);
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await driver.close();
  await connection.quit().catch(() => undefined);
  await disconnectPrisma();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
