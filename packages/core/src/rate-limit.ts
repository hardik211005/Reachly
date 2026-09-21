import { Redis } from "ioredis";
import { logger } from "./logger";

/**
 * Fixed-window rate limiter. Uses Redis (shared across instances) when QUEUE_DRIVER is
 * bullmq; falls back to an in-process map for single-instance local development.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  limit: number;
}

type GlobalWithLimiter = typeof globalThis & {
  __reachRateRedis?: Redis | null;
  __reachRateMemory?: Map<string, { count: number; resetAt: number }>;
};

function redisClient(): Redis | null {
  const g = globalThis as GlobalWithLimiter;
  if (g.__reachRateRedis !== undefined) return g.__reachRateRedis;
  if (process.env.QUEUE_DRIVER === "inline" || !process.env.REDIS_URL) {
    g.__reachRateRedis = null;
    return null;
  }
  const client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  client.on("error", (error) => logger.warn({ err: error }, "rate-limit redis error"));
  g.__reachRateRedis = client;
  return client;
}

function memory(): Map<string, { count: number; resetAt: number }> {
  const g = globalThis as GlobalWithLimiter;
  g.__reachRateMemory ??= new Map();
  return g.__reachRateMemory;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const resetSeconds = windowStart + windowSeconds - Math.floor(Date.now() / 1000);
  const bucket = `rl:${key}:${windowStart}`;

  const redis = redisClient();
  if (redis && redis.status === "ready") {
    try {
      const count = await redis.incr(bucket);
      if (count === 1) await redis.expire(bucket, windowSeconds + 1);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSeconds, limit };
    } catch (error) {
      logger.warn({ err: error }, "rate-limit redis failure; falling back to memory");
    }
  }

  const store = memory();
  const now = Date.now();
  const entry = store.get(bucket);
  if (!entry || entry.resetAt < now) {
    store.set(bucket, { count: 1, resetAt: (windowStart + windowSeconds) * 1000 });
    if (store.size > 10_000) {
      for (const [storedKey, value] of store) if (value.resetAt < now) store.delete(storedKey);
    }
    return { allowed: true, remaining: limit - 1, resetSeconds, limit };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetSeconds, limit };
}
