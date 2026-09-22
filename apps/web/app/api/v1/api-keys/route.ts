import { z } from "zod";
import { createApiKey, listApiKeys } from "@repo/core/api-keys";
import { hasFeature } from "@repo/core/billing/plans";
import { API_KEY_SCOPES } from "@repo/core/rbac";
import { created, ok, route } from "@/lib/api";

const body = z.object({
  name: z.string().trim().min(1, "Name the key").max(60),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, "Pick at least one scope"),
  expiresInDays: z.number().int().min(1).max(730).nullish(),
});

export const GET = route({ permission: "apikeys:manage" }, async ({ ctx }) => {
  const [keys, apiAccess] = await Promise.all([listApiKeys(ctx), hasFeature(ctx, "apiAccess")]);
  return ok({ keys, apiAccess });
});

/** The raw key is in this response only and can never be retrieved again. */
export const POST = route({ body, permission: "apikeys:manage", rateLimit: 10 }, async ({ ctx, body: input }) => {
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const { key, record } = await createApiKey(ctx, { name: input.name, scopes: input.scopes, expiresAt });
  return created({ key, id: record.id, name: record.name, prefix: record.prefix, scopes: record.scopes, expiresAt: record.expiresAt, createdAt: record.createdAt });
});
