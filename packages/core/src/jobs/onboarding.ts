import { getEnv } from "@repo/config/env";
import { HttpN8nClient } from "@repo/integrations";
import { BUSINESS_REGISTERED_WEBHOOK_PATH, businessRegisteredPayload } from "../onboarding/autopilot";
import { logger } from "../logger";
import { registerProcessor } from "./registry";

/** Signed POST to the operator's n8n (platform N8N_URL) when a business finishes registering. */
registerProcessor("platform.business-registered", async ({ organizationId, discoveryRunId }) => {
  const env = getEnv();
  if (!env.N8N_URL) return { skipped: "N8N_URL is not set" };
  const client = new HttpN8nClient({ baseUrl: env.N8N_URL, apiKey: env.N8N_API_KEY, webhookSecret: env.N8N_WEBHOOK_SECRET });
  const result = await client.triggerWebhook(BUSINESS_REGISTERED_WEBHOOK_PATH, await businessRegisteredPayload(organizationId, discoveryRunId ?? null));
  // 404 = no active n8n workflow on that path yet; retrying won't help until someone imports it.
  if (result.status === 404) {
    logger.warn({ organizationId }, "n8n has no active 'reachly-business-registered' workflow — import apps/web/public/n8n/reachai-business-registered.json");
    return { status: 404 };
  }
  if (result.status >= 400) throw new Error(`n8n answered HTTP ${result.status}`);
  return { status: result.status };
});
