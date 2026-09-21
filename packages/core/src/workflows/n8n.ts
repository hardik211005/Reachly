import { getEnv } from "@repo/config/env";
import { assertCan, type TenantContext } from "../context";
import { getConnectedIntegration } from "../integrations/credentials";
import { resolveN8n } from "./engine";

/** Importable n8n workflows shipped with the app (apps/web/public/n8n). */
export const N8N_TEMPLATES = [
  {
    file: "reachai-meeting-booked.json",
    name: "Meeting booked → your tools",
    description: "Receives ReachAI's “Run n8n workflow” step, verifies the signature and appends the meeting to Google Sheets (enable the Sheets node once credentials are set).",
    webhookPath: "reachai-meeting-booked",
  },
  {
    file: "reachai-enrich-callback.json",
    name: "Enrich and call back",
    description: "Pattern for steps that wait: does work in n8n, then POSTs the result to ReachAI's callback URL so the workflow continues with the data.",
    webhookPath: "reachai-enrich",
  },
  {
    file: "reachai-daily-digest.json",
    name: "Daily digest to Slack",
    description: "Every morning, reads yesterday's numbers from the ReachAI API with an API key and posts them to Slack.",
    webhookPath: null,
  },
] as const;

export async function n8nStatus(ctx: TenantContext) {
  assertCan(ctx, "workflows:read");
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "AUTOMATION", "n8n");
  const mode: "connected" | "platform" | "mock" | "not_configured" = integration ? "connected" : env.N8N_URL ? "platform" : env.DEMO_MODE ? "mock" : "not_configured";
  const client = mode === "not_configured" ? null : await resolveN8n(ctx);
  const health = client ? await client.health() : { ok: false, detail: "Not connected" };
  let workflows: Awaited<ReturnType<NonNullable<typeof client>["listWorkflows"]>> = [];
  let listError: string | null = null;
  if (client && !client.isMock && health.ok) {
    try {
      workflows = await client.listWorkflows();
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    mode,
    baseUrl: client?.baseUrl ?? null,
    health,
    workflows,
    listError,
    signed: Boolean(integration?.credentials.webhookSecret ?? env.N8N_WEBHOOK_SECRET),
    callbackUrl: `${env.APP_URL}/api/hooks/n8n/callback`,
    templates: N8N_TEMPLATES,
  };
}
