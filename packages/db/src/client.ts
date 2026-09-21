import { PrismaPg } from "@prisma/adapter-pg";
import { loadRootEnv } from "@repo/config/env";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Process-wide Prisma client. In development the instance is cached on globalThis so
 * Next.js hot reloads don't exhaust the connection pool.
 */

type GlobalWithPrisma = typeof globalThis & { __reachPrisma?: PrismaClient };

function createClient(): PrismaClient {
  if (!process.env.DATABASE_URL) loadRootEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG_QUERIES === "true" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

let instance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  const g = globalThis as GlobalWithPrisma;
  if (g.__reachPrisma) return g.__reachPrisma;
  if (!instance) instance = createClient();
  if (process.env.NODE_ENV !== "production") g.__reachPrisma = instance;
  return instance;
}

/**
 * Lazily-initialised client proxy so importing this module never opens a connection
 * (important for build steps and tests that don't touch the database).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrisma();
    const value: unknown = Reflect.get(client, property, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

export async function disconnectPrisma(): Promise<void> {
  const g = globalThis as GlobalWithPrisma;
  const client = g.__reachPrisma ?? instance;
  if (client) await client.$disconnect();
  instance = undefined;
  g.__reachPrisma = undefined;
}
