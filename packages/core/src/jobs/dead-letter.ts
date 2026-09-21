import { logger } from "../logger";

/**
 * Dead-letter visibility. BullMQ keeps failed jobs in Redis (inspected by the system
 * health page); this ring buffer additionally captures final failures seen by the current
 * process — the only record for the inline driver.
 */

export interface DeadLetterEntry {
  jobId: string;
  name: string;
  error: string;
  attempts: number;
  failedAt: string;
  data: unknown;
}

type GlobalWithDeadLetters = typeof globalThis & { __reachDeadLetters?: DeadLetterEntry[] };

function buffer(): DeadLetterEntry[] {
  const g = globalThis as GlobalWithDeadLetters;
  g.__reachDeadLetters ??= [];
  return g.__reachDeadLetters;
}

export function recordDeadLetter(entry: Omit<DeadLetterEntry, "failedAt">): void {
  const list = buffer();
  list.unshift({ ...entry, failedAt: new Date().toISOString() });
  if (list.length > 100) list.length = 100;
  logger.error({ job: entry.name, jobId: entry.jobId, attempts: entry.attempts, error: entry.error }, "job moved to dead-letter");
}

export function recentDeadLetters(limit = 25): DeadLetterEntry[] {
  return buffer().slice(0, limit);
}
