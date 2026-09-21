import { brand } from "@repo/config";
import { prisma } from "@repo/db";
import { audit } from "./audit";
import { assertCan, type TenantContext } from "./context";
import { hashToken, randomToken } from "./crypto";
import { NotFoundError, ValidationError } from "./errors";
import { assertFeature } from "./billing/plans";
import { API_KEY_SCOPES, type ApiKeyScope } from "./rbac";

/**
 * Organisation API keys (Scale plan). The raw key is returned once at creation; only a
 * SHA-256 hash is stored. Format: `<prefix>_live_<random>`.
 */

export async function createApiKey(ctx: TenantContext, input: { name: string; scopes: ApiKeyScope[]; expiresAt?: Date | null }) {
  assertCan(ctx, "apikeys:manage");
  await assertFeature(ctx, "apiAccess");
  if (!input.name.trim()) throw new ValidationError("Name is required");
  const scopes = input.scopes.filter((scope) => API_KEY_SCOPES.includes(scope));
  if (!scopes.length) throw new ValidationError("Select at least one scope");
  const raw = `${brand.apiKeyPrefix}_live_${randomToken(24)}`;
  const key = await ctx.db.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name.trim(),
      prefix: raw.slice(0, 16),
      hashedKey: hashToken(raw),
      scopes,
      createdById: ctx.userId ?? ctx.actor.id ?? "system",
      expiresAt: input.expiresAt ?? null,
    },
  });
  await audit(ctx, { action: "api_key.created", resourceType: "api_key", resourceId: key.id, metadata: { scopes } });
  return { key: raw, record: { ...key, hashedKey: undefined } };
}

export async function listApiKeys(ctx: TenantContext) {
  assertCan(ctx, "apikeys:manage");
  const keys = await ctx.db.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  return keys.map(({ hashedKey: _hash, ...key }) => key);
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  assertCan(ctx, "apikeys:manage");
  const key = await ctx.db.apiKey.findFirst({ where: { id, revokedAt: null } });
  if (!key) throw new NotFoundError("API key", id);
  await ctx.db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(ctx, { action: "api_key.revoked", resourceType: "api_key", resourceId: id });
}

/** Resolves a bearer key to its organisation; returns null for unknown/revoked/expired keys. */
export async function authenticateApiKey(raw: string) {
  if (!raw.startsWith(`${brand.apiKeyPrefix}_`)) return null;
  const key = await prisma.apiKey.findUnique({ where: { hashedKey: hashToken(raw) } });
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
  // Throttle lastUsedAt writes to once a minute.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return key;
}
