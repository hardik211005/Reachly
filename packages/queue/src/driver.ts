import { randomUUID } from "node:crypto";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import {
  BACKOFF_BASE_MS,
  DEFAULT_ATTEMPTS,
  JOBS,
  SCHEDULES,
  backoffDelayMs,
  type JobData,
  type JobName,
  type QueueName,
} from "./jobs";

export interface EnqueueOptions {
  /** Run no earlier than this many ms from now. */
  delayMs?: number;
  /** Deduplication id: a job with the same id that is still pending is not enqueued twice. */
  jobId?: string;
  priority?: number;
  attempts?: number;
}

export interface JobMeta {
  jobId: string;
  attempt: number;
  maxAttempts: number;
}

export type JobHandler = (name: JobName, data: unknown, meta: JobMeta) => Promise<unknown>;

export interface DeadLetterInfo {
  jobId: string;
  name: string;
  data: unknown;
  error: string;
  attempts: number;
}

export interface QueueStats {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface QueueDriver {
  readonly kind: "bullmq" | "inline";
  enqueue<N extends JobName>(name: N, data: JobData<N>, opts?: EnqueueOptions): Promise<string>;
  stats(): Promise<QueueStats[]>;
  close(): Promise<void>;
}

export function defaultJobOptions(attempts = DEFAULT_ATTEMPTS): JobsOptions {
  return {
    attempts,
    backoff: { type: "exponential", delay: BACKOFF_BASE_MS },
    removeOnComplete: { age: 24 * 3600, count: 2000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

export function createRedisConnection(url: string): Redis {
  // maxRetriesPerRequest must be null for BullMQ blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

// ---------------------------------------------------------------------------
// BullMQ (production)
// ---------------------------------------------------------------------------

export class BullMQDriver implements QueueDriver {
  readonly kind = "bullmq" as const;
  private readonly queues = new Map<QueueName, Queue>();
  private readonly connection: Redis;

  constructor(redisUrl: string) {
    this.connection = createRedisConnection(redisUrl);
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, defaultJobOptions: defaultJobOptions() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<N extends JobName>(name: N, data: JobData<N>, opts: EnqueueOptions = {}): Promise<string> {
    const definition = JOBS[name];
    const payload = definition.schema.parse(data);
    const job = await this.queue(definition.queue).add(name, payload, {
      ...defaultJobOptions(opts.attempts),
      jobId: opts.jobId,
      delay: opts.delayMs,
      priority: opts.priority,
    });
    return job.id ?? opts.jobId ?? randomUUID();
  }

  async upsertSchedules(include: (job: JobName) => boolean = () => true): Promise<void> {
    for (const schedule of SCHEDULES) {
      if (!include(schedule.job)) {
        await this.queue(JOBS[schedule.job].queue).removeJobScheduler(schedule.id).catch(() => undefined);
        continue;
      }
      const definition = JOBS[schedule.job];
      await this.queue(definition.queue).upsertJobScheduler(
        schedule.id,
        schedule.pattern ? { pattern: schedule.pattern } : { every: schedule.everyMs ?? 60_000 },
        { name: schedule.job, data: {}, opts: defaultJobOptions(3) },
      );
    }
  }

  async stats(): Promise<QueueStats[]> {
    const names = [...new Set(Object.values(JOBS).map((job) => job.queue))];
    return Promise.all(
      names.map(async (name) => {
        const counts = await this.queue(name).getJobCounts(
          "waiting",
          "active",
          "delayed",
          "completed",
          "failed",
        );
        return {
          queue: name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
        };
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
    await this.connection.quit().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Inline (local development without Redis)
// ---------------------------------------------------------------------------

interface InlineCounters {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

/**
 * Runs jobs inside the current process with the same validation, retry and backoff policy
 * as BullMQ. State is in memory: pending jobs are lost on restart. Development only.
 */
export class InlineDriver implements QueueDriver {
  readonly kind = "inline" as const;
  private handler: JobHandler | undefined;
  private readonly pending = new Set<string>();
  private readonly counters = new Map<QueueName, InlineCounters>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private scheduled = false;

  constructor(private readonly onDeadLetter?: (info: DeadLetterInfo) => void) {}

  setHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  hasHandler(): boolean {
    return this.handler !== undefined;
  }

  private counter(queue: QueueName): InlineCounters {
    let counter = this.counters.get(queue);
    if (!counter) {
      counter = { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 };
      this.counters.set(queue, counter);
    }
    return counter;
  }

  async enqueue<N extends JobName>(name: N, data: JobData<N>, opts: EnqueueOptions = {}): Promise<string> {
    const definition = JOBS[name];
    const payload = definition.schema.parse(data);
    const jobId = opts.jobId ?? randomUUID();
    if (opts.jobId && this.pending.has(jobId)) return jobId;
    this.pending.add(jobId);

    const counter = this.counter(definition.queue);
    const delay = Math.max(0, opts.delayMs ?? 0);
    if (delay > 0) counter.delayed += 1;
    else counter.waiting += 1;

    this.schedule(delay, () => {
      if (delay > 0) counter.delayed -= 1;
      else counter.waiting -= 1;
      void this.run(jobId, name, payload, 1, opts.attempts ?? DEFAULT_ATTEMPTS);
    });
    return jobId;
  }

  private schedule(delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async run(jobId: string, name: JobName, data: unknown, attempt: number, maxAttempts: number) {
    const counter = this.counter(JOBS[name].queue);
    if (!this.handler) {
      // Handlers register at server start; retry shortly instead of dropping the job.
      this.schedule(1_000, () => void this.run(jobId, name, data, attempt, maxAttempts));
      return;
    }
    counter.active += 1;
    try {
      await this.handler(name, data, { jobId, attempt, maxAttempts });
      counter.completed += 1;
      this.pending.delete(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && !isNonRetryable(error)) {
        this.schedule(backoffDelayMs(attempt), () => void this.run(jobId, name, data, attempt + 1, maxAttempts));
      } else {
        counter.failed += 1;
        this.pending.delete(jobId);
        this.onDeadLetter?.({ jobId, name, data, error: message, attempts: attempt });
      }
    } finally {
      counter.active -= 1;
    }
  }

  /** Starts recurring jobs; `include` limits them to jobs that have a processor. */
  startSchedules(include: (job: JobName) => boolean = () => true): void {
    if (this.scheduled) return;
    this.scheduled = true;
    for (const schedule of SCHEDULES.filter((item) => include(item.job))) {
      const timer = setInterval(() => {
        void this.enqueue(schedule.job, {} as JobData<typeof schedule.job>, { jobId: `${schedule.id}` });
      }, schedule.inlineEveryMs);
      timer.unref?.();
    }
  }

  async stats(): Promise<QueueStats[]> {
    return [...this.counters.entries()].map(([queue, counter]) => ({ queue, ...counter }));
  }

  async close(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

/** Errors marked non-retryable (validation, not found, limits) skip remaining attempts. */
export function isNonRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { retryable?: boolean }).retryable === false;
}
