/**
 * Importing this module registers every job processor. Both runtimes import it:
 * apps/worker (BullMQ) and the Next.js server in inline-queue mode (instrumentation.ts).
 */
import "./events";
import "./housekeeping";

export { processJob, registeredJobNames, hasProcessor, registerProcessor, NonRetryableJobError } from "./registry";
export { recordDeadLetter, recentDeadLetters } from "./dead-letter";
export { registerEventSubscriber } from "./events";
