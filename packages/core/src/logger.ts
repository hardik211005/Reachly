import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Attach request/job/org/workflow ids with `logger.child({...})`
 * so every line can be correlated across the web app, worker and providers.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: process.env.SERVICE_NAME ?? "reachai" },
  redact: {
    paths: [
      "*.password",
      "*.apiKey",
      "*.token",
      "*.accessToken",
      "*.authorization",
      "*.credentials",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type { Logger };

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
