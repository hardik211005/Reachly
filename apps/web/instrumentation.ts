/**
 * Runs once per Next.js server process. In local development without Redis
 * (QUEUE_DRIVER=inline) background jobs execute inside this process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("@repo/config/env");
  if (getEnv().QUEUE_DRIVER !== "inline") return;
  const { startInlineWorker } = await import("@repo/core/jobs/inline");
  startInlineWorker();
}
