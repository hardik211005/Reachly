import type { IntegrationCategory } from "@repo/db";
import type { TenantContext } from "../context";
import { decryptJson } from "../crypto";
import { logger } from "../logger";

export interface ResolvedIntegration {
  id: string;
  provider: string;
  category: IntegrationCategory;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
}

/**
 * Returns the organisation's connected integration for a category (the default one if
 * several are connected), with decrypted credentials. Never expose the result to clients.
 */
export async function getConnectedIntegration(
  ctx: TenantContext,
  category: IntegrationCategory,
  provider?: string,
): Promise<ResolvedIntegration | null> {
  const integration = await ctx.db.integration.findFirst({
    where: { category, status: "CONNECTED", ...(provider ? { provider } : {}) },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!integration) return null;
  let credentials: Record<string, string> = {};
  if (integration.encryptedCredentials) {
    try {
      credentials = decryptJson<Record<string, string>>(integration.encryptedCredentials);
    } catch (error) {
      logger.error({ err: error, integrationId: integration.id }, "failed to decrypt integration credentials");
      return null;
    }
  }
  return {
    id: integration.id,
    provider: integration.provider,
    category: integration.category,
    config: (integration.config ?? {}) as Record<string, unknown>,
    credentials,
  };
}
