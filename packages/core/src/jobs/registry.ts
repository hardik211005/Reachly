import { isJobName, parseJobData, type JobMeta, type JobName, type ParsedJobData } from "@repo/queue";
import { AppError } from "../errors";
import { logger } from "../logger";

/**
 * Job processor registry shared by the BullMQ worker (apps/worker) and the inline driver
 * (local dev). Modules register processors for their jobs; `processJob` validates the
 * payload against the job's Zod schema before dispatching.
 */

export type Processor<N extends JobName> = (data: ParsedJobData<N>, meta: JobMeta) => Promise<unknown>;

const processors = new Map<JobName, Processor<JobName>>();

export function registerProcessor<N extends JobName>(name: N, processor: Processor<N>): void {
  processors.set(name, processor as unknown as Processor<JobName>);
}

export function hasProcessor(name: JobName): boolean {
  return processors.has(name);
}

export function registeredJobNames(): JobName[] {
  return [...processors.keys()];
}

export class NonRetryableJobError extends Error {
  readonly retryable = false;
  override name = "NonRetryableJobError";
}

export async function processJob(name: string, data: unknown, meta: JobMeta): Promise<unknown> {
  if (!isJobName(name)) throw new NonRetryableJobError(`Unknown job ${name}`);
  const processor = processors.get(name);
  if (!processor) throw new NonRetryableJobError(`No processor registered for ${name}`);
  const payload = parseJobData(name, data);
  const log = logger.child({ job: name, jobId: meta.jobId, attempt: meta.attempt });
  const started = Date.now();
  try {
    const result = await processor(payload, meta);
    log.debug({ ms: Date.now() - started }, "job completed");
    return result;
  } catch (error) {
    // Application errors that can't succeed on retry (validation, limits, not found…)
    // are surfaced as non-retryable so they go straight to the dead-letter queue.
    if (error instanceof AppError && !error.retryable) {
      log.warn({ err: error }, "job failed (non-retryable)");
      throw Object.assign(new NonRetryableJobError(error.message), { cause: error });
    }
    log.error({ err: error, ms: Date.now() - started }, "job failed");
    throw error;
  }
}
