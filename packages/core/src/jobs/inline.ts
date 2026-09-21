import { getInlineDriver, onDeadLetter } from "@repo/queue";
import { logger } from "../logger";
import { recordDeadLetter } from "./dead-letter";
import { hasProcessor, processJob } from "./index";

/**
 * Starts in-process job execution for QUEUE_DRIVER=inline (local development without
 * Redis). Called once from the Next.js instrumentation hook.
 */
export function startInlineWorker(): void {
  const driver = getInlineDriver();
  if (!driver || driver.hasHandler()) return;
  onDeadLetter((info) => recordDeadLetter({ jobId: info.jobId, name: info.name, error: info.error, attempts: info.attempts, data: info.data }));
  driver.setHandler((name, data, meta) => processJob(name, data, meta));
  driver.startSchedules((job) => hasProcessor(job));
  logger.warn("QUEUE_DRIVER=inline: background jobs run inside the web process (development only)");
}
