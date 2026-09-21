import { getEnv } from "@repo/config/env";
import type { IntegrationCategory } from "@repo/db";
import type { TenantContext } from "../context";

/**
 * Where each capability is served from, in resolution order:
 *   connected       — the organisation connected its own account (Integrations page)
 *   platform        — configured by the operator via environment variables
 *   mock            — DEMO_MODE fallback; actions are simulated and labelled as such
 *   not_configured  — nothing available; the UI shows "Connect provider"
 */
export type ProviderMode = "connected" | "platform" | "mock" | "not_configured";

export interface ProviderStatus {
  category: IntegrationCategory;
  label: string;
  mode: ProviderMode;
  provider: string | null;
}

const LABELS: Partial<Record<IntegrationCategory, string>> = {
  AI: "AI",
  LEAD_DATA: "Lead data",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  VOICE: "Voice",
  PAYMENTS: "Billing",
  AUTOMATION: "n8n automation",
  STORAGE: "File storage",
};

function platformProvider(category: IntegrationCategory): string | null {
  const env = getEnv();
  switch (category) {
    case "AI":
      if (env.AI_DEFAULT_PROVIDER === "openai" && env.OPENAI_API_KEY) return "openai";
      if (env.AI_DEFAULT_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) return "anthropic";
      if (env.AI_DEFAULT_PROVIDER === "google" && env.GOOGLE_AI_API_KEY) return "google";
      return null;
    case "LEAD_DATA":
      return env.LEAD_PROVIDER === "google_places" && env.GOOGLE_PLACES_API_KEY ? "google_places" : null;
    case "EMAIL":
      if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return "resend";
      if (env.EMAIL_PROVIDER === "sendgrid" && env.SENDGRID_API_KEY) return "sendgrid";
      if (env.EMAIL_PROVIDER === "smtp" && env.SMTP_HOST) return "smtp";
      return null;
    case "WHATSAPP":
      return env.WHATSAPP_PROVIDER === "meta" && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? "meta" : null;
    case "VOICE":
      if (env.VOICE_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) return "twilio";
      if (env.VOICE_PROVIDER === "vapi" && env.VAPI_API_KEY) return "vapi";
      return null;
    case "PAYMENTS":
      return env.STRIPE_SECRET_KEY ? "stripe" : null;
    case "AUTOMATION":
      return env.N8N_URL && env.N8N_API_KEY ? "n8n" : null;
    case "STORAGE":
      if (env.STORAGE_DRIVER === "s3" && env.S3_BUCKET && env.S3_ACCESS_KEY_ID) return "s3";
      return env.STORAGE_DRIVER === "local" ? "local" : null;
    default:
      return null;
  }
}

/** Categories where a mock fallback exists (billing/storage/n8n have honest "not configured" states instead). */
const MOCKABLE: ReadonlySet<IntegrationCategory> = new Set(["AI", "LEAD_DATA", "EMAIL", "WHATSAPP", "VOICE"]);

export async function getProviderStatuses(ctx: TenantContext): Promise<ProviderStatus[]> {
  const env = getEnv();
  const connected = await ctx.db.integration.findMany({ where: { status: "CONNECTED" }, select: { category: true, provider: true } });
  const byCategory = new Map(connected.map((integration) => [integration.category, integration.provider]));

  return (Object.keys(LABELS) as IntegrationCategory[]).map((category) => {
    const label = LABELS[category] ?? category;
    const own = byCategory.get(category);
    if (own && own !== "mock") return { category, label, mode: "connected", provider: own };
    const platform = platformProvider(category);
    if (platform) return { category, label, mode: "platform", provider: platform };
    if (env.DEMO_MODE && MOCKABLE.has(category)) return { category, label, mode: "mock", provider: "mock" };
    return { category, label, mode: "not_configured", provider: null };
  });
}

export async function getProviderMode(ctx: TenantContext, category: IntegrationCategory): Promise<ProviderStatus> {
  const statuses = await getProviderStatuses(ctx);
  return statuses.find((status) => status.category === category) ?? { category, label: category, mode: "not_configured", provider: null };
}
