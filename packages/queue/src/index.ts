import { loadRootEnv } from "@repo/config/env";
import { BullMQDriver, InlineDriver, type DeadLetterInfo, type QueueDriver } from "./driver";

export * from "./jobs";
export * from "./driver";

type GlobalWithQueue = typeof globalThis & { __reachQueue?: QueueDriver };

let deadLetterListener: ((info: DeadLetterInfo) => void) | undefined;

/** Registers a listener for jobs that exhausted their retries (inline driver). */
export function onDeadLetter(listener: (info: DeadLetterInfo) => void): void {
  deadLetterListener = listener;
}

/**
 * Process-wide queue driver chosen by QUEUE_DRIVER. Cached on globalThis so Next.js hot
 * reloads reuse connections.
 */
export function getQueue(): QueueDriver {
  const g = globalThis as GlobalWithQueue;
  if (g.__reachQueue) return g.__reachQueue;
  if (!process.env.QUEUE_DRIVER) loadRootEnv();
  const driver: QueueDriver =
    process.env.QUEUE_DRIVER === "inline"
      ? new InlineDriver((info) => deadLetterListener?.(info))
      : new BullMQDriver(process.env.REDIS_URL ?? "redis://localhost:6379");
  g.__reachQueue = driver;
  return driver;
}

export function getInlineDriver(): InlineDriver | undefined {
  const driver = getQueue();
  return driver instanceof InlineDriver ? driver : undefined;
}

export async function closeQueue(): Promise<void> {
  const g = globalThis as GlobalWithQueue;
  if (g.__reachQueue) await g.__reachQueue.close();
  g.__reachQueue = undefined;
}
