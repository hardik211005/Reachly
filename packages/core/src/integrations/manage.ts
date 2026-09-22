import { z } from "zod";
import { MODEL_CATALOG } from "@repo/config";
import { getEnv } from "@repo/config/env";
import type { IntegrationCategory } from "@repo/db";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { decryptJson, encryptJson } from "../crypto";
import { NotFoundError, ValidationError } from "../errors";
import { getProviderStatuses, type ProviderStatus } from "./status";

/**
 * Connecting a workspace's own provider accounts. Each provider declares its fields;
 * secret fields are encrypted (AES-256-GCM) into `encryptedCredentials`, the rest go to
 * `config`. Secrets never leave the server: clients only learn which ones are set. The
 * field keys match what the provider resolvers read (see outreach/providers.ts,
 * calls/providers.ts, leads/providers.ts, ai/service.ts, jobs/housekeeping.ts).
 */

export interface ProviderField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  type?: "text" | "email" | "number" | "select" | "url";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
}

export interface ProviderDefinition {
  provider: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  docsUrl: string;
  fields: ProviderField[];
  /** Path the provider should send webhooks to, if any. `{id}` is the integration id. */
  webhookPath?: string;
}

const models = (provider: string) => MODEL_CATALOG.filter((model) => model.provider === provider).map((model) => ({ value: model.id, label: model.label }));
const SENDER_FIELDS: ProviderField[] = [
  { key: "fromEmail", label: "From address", secret: false, required: true, type: "email", placeholder: "hello@yourcompany.com", help: "Must be a sender verified with the provider." },
  { key: "fromName", label: "From name", secret: false, required: false, placeholder: "Your company" },
  { key: "replyTo", label: "Reply-to address", secret: false, required: false, type: "email" },
];

export const PROVIDER_CATALOG: ProviderDefinition[] = [
  {
    provider: "anthropic",
    category: "AI",
    name: "Anthropic",
    description: "Claude models for qualification, writing, calls and insights.",
    docsUrl: "https://docs.anthropic.com",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "sk-ant-…" },
      { key: "model", label: "Model", secret: false, required: false, type: "select", options: models("anthropic") },
    ],
  },
  {
    provider: "openai",
    category: "AI",
    name: "OpenAI",
    description: "GPT models for every AI agent.",
    docsUrl: "https://platform.openai.com/docs",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "sk-…" },
      { key: "model", label: "Model", secret: false, required: false, type: "select", options: models("openai") },
    ],
  },
  {
    provider: "google",
    category: "AI",
    name: "Google Gemini",
    description: "Gemini models for every AI agent.",
    docsUrl: "https://ai.google.dev",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "model", label: "Model", secret: false, required: false, type: "select", options: models("google") },
    ],
  },
  {
    provider: "google_places",
    category: "LEAD_DATA",
    name: "Google Places",
    description: "Discover businesses by category and area.",
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service",
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true }],
  },
  {
    provider: "resend",
    category: "EMAIL",
    name: "Resend",
    description: "Send outreach from your own domain, with delivery and reply tracking.",
    docsUrl: "https://resend.com/docs",
    webhookPath: "/api/webhooks/email/resend?integration={id}",
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true, placeholder: "re_…" }, { key: "webhookSecret", label: "Webhook signing secret", secret: true, required: false, placeholder: "whsec_…" }, ...SENDER_FIELDS],
  },
  {
    provider: "sendgrid",
    category: "EMAIL",
    name: "SendGrid",
    description: "Send outreach through your SendGrid account.",
    docsUrl: "https://www.twilio.com/docs/sendgrid",
    webhookPath: "/api/webhooks/email/sendgrid?integration={id}",
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true, placeholder: "SG.…" }, { key: "webhookPublicKey", label: "Event webhook verification key", secret: true, required: false }, ...SENDER_FIELDS],
  },
  {
    provider: "smtp",
    category: "EMAIL",
    name: "SMTP",
    description: "Any mail server, including Google Workspace and Microsoft 365.",
    docsUrl: "https://en.wikipedia.org/wiki/Simple_Mail_Transfer_Protocol",
    fields: [
      { key: "host", label: "Host", secret: true, required: true, placeholder: "smtp.yourprovider.com" },
      { key: "port", label: "Port", secret: true, required: true, type: "number", placeholder: "587" },
      { key: "secure", label: "Connection", secret: true, required: true, type: "select", options: [{ value: "false", label: "STARTTLS (587)" }, { value: "true", label: "SSL/TLS (465)" }] },
      { key: "user", label: "Username", secret: true, required: false },
      { key: "password", label: "Password", secret: true, required: false },
      ...SENDER_FIELDS,
    ],
  },
  {
    provider: "meta",
    category: "WHATSAPP",
    name: "WhatsApp Cloud API",
    description: "Your own WhatsApp Business number through Meta's official API.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    webhookPath: "/api/webhooks/whatsapp",
    fields: [
      { key: "accessToken", label: "Permanent access token", secret: true, required: true },
      { key: "appSecret", label: "App secret", secret: true, required: true, help: "Used to verify webhooks from Meta." },
      { key: "phoneNumberId", label: "Phone number ID", secret: false, required: true },
      { key: "businessAccountId", label: "WhatsApp Business account ID", secret: false, required: false, help: "Needed to sync message templates." },
    ],
  },
  {
    provider: "twilio",
    category: "VOICE",
    name: "Twilio",
    description: "Phone calls with a turn-by-turn AI conversation.",
    docsUrl: "https://www.twilio.com/docs/voice",
    webhookPath: "/api/webhooks/voice/twilio",
    fields: [
      { key: "accountSid", label: "Account SID", secret: true, required: true, placeholder: "AC…" },
      { key: "authToken", label: "Auth token", secret: true, required: true },
      { key: "fromNumber", label: "Caller number", secret: false, required: true, placeholder: "+91…" },
    ],
  },
  {
    provider: "vapi",
    category: "VOICE",
    name: "Vapi",
    description: "A hosted AI voice agent.",
    docsUrl: "https://docs.vapi.ai",
    webhookPath: "/api/webhooks/voice/vapi",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "webhookSecret", label: "Webhook secret", secret: true, required: false },
      { key: "phoneNumberId", label: "Phone number ID", secret: false, required: true },
    ],
  },
  {
    provider: "slack",
    category: "NOTIFICATION",
    name: "Slack",
    description: "Post team notifications — hot replies, booked meetings, accepted quotes — to a channel.",
    docsUrl: "https://api.slack.com/messaging/webhooks",
    fields: [{ key: "webhookUrl", label: "Incoming webhook URL", secret: true, required: true, type: "url", placeholder: "https://hooks.slack.com/services/…" }],
  },
];

export function providerDefinition(provider: string): ProviderDefinition {
  const definition = PROVIDER_CATALOG.find((item) => item.provider === provider);
  if (!definition) throw new NotFoundError("Integration provider", provider);
  return definition;
}

export interface IntegrationView {
  provider: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  docsUrl: string;
  fields: ProviderField[];
  connection: null | {
    id: string;
    status: "CONNECTED" | "DISCONNECTED" | "ERROR";
    isDefault: boolean;
    config: Record<string, unknown>;
    /** Which secret fields have a stored value (the values themselves are never returned). */
    secretsSet: string[];
    webhookUrl: string | null;
    lastError: string | null;
    updatedAt: Date;
  };
}

export async function listIntegrations(ctx: TenantContext): Promise<{ providers: IntegrationView[]; statuses: ProviderStatus[] }> {
  assertCan(ctx, "workspace:read");
  const [rows, statuses] = await Promise.all([ctx.db.integration.findMany({ orderBy: { updatedAt: "desc" } }), getProviderStatuses(ctx)]);
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const providers = PROVIDER_CATALOG.map((definition): IntegrationView => {
    const row = rows.find((item) => item.provider === definition.provider);
    let secretsSet: string[] = [];
    if (row?.encryptedCredentials) {
      try {
        const stored = decryptJson<Record<string, string>>(row.encryptedCredentials);
        secretsSet = Object.keys(stored).filter((key) => Boolean(stored[key]));
      } catch {
        secretsSet = [];
      }
    }
    return {
      provider: definition.provider,
      category: definition.category,
      name: definition.name,
      description: definition.description,
      docsUrl: definition.docsUrl,
      fields: definition.fields,
      connection: row
        ? {
            id: row.id,
            status: row.status,
            isDefault: row.isDefault,
            config: (row.config ?? {}) as Record<string, unknown>,
            secretsSet,
            webhookUrl: definition.webhookPath ? `${appUrl}${definition.webhookPath.replace("{id}", row.id)}` : null,
            lastError: row.lastError,
            updatedAt: row.updatedAt,
          }
        : null,
    };
  });
  return { providers, statuses };
}

export const connectIntegrationSchema = z.object({ values: z.record(z.string(), z.string().max(4000)) });

/** Connects (or updates) a provider. Blank secret fields keep their stored value. */
export async function connectIntegration(ctx: TenantContext, provider: string, input: z.input<typeof connectIntegrationSchema>) {
  assertCan(ctx, "integrations:manage");
  const definition = providerDefinition(provider);
  const { values } = connectIntegrationSchema.parse(input);
  const existing = await ctx.db.integration.findFirst({ where: { provider } });
  let storedSecrets: Record<string, string> = {};
  if (existing?.encryptedCredentials) {
    try {
      storedSecrets = decryptJson<Record<string, string>>(existing.encryptedCredentials);
    } catch {
      storedSecrets = {};
    }
  }

  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of definition.fields) {
    const raw = (values[field.key] ?? "").trim();
    const value = field.secret && !raw ? (storedSecrets[field.key] ?? "") : raw;
    if (field.required && !value) {
      missing.push(field.label);
      continue;
    }
    if (!value) continue;
    if (field.type === "email" && !z.email().safeParse(value).success) throw new ValidationError(`${field.label} must be an email address`);
    if (field.type === "url" && !/^https:\/\//.test(value)) throw new ValidationError(`${field.label} must start with https://`);
    if (field.type === "number" && !/^\d+$/.test(value)) throw new ValidationError(`${field.label} must be a number`);
    if (field.options && !field.options.some((option) => option.value === value)) throw new ValidationError(`Choose a valid ${field.label.toLowerCase()}`);
    (field.secret ? secrets : config)[field.key] = value;
  }
  if (missing.length) throw new ValidationError(`Fill in: ${missing.join(", ")}`);

  const data = { category: definition.category, status: "CONNECTED" as const, config, encryptedCredentials: Object.keys(secrets).length ? encryptJson(secrets) : null, isDefault: true, lastError: null, lastCheckedAt: new Date(), connectedById: ctx.userId };
  const integration = await ctx.db.$transaction(async (tx) => {
    // The newest connection in a category becomes the one the product uses.
    await tx.integration.updateMany({ where: { organizationId: ctx.organizationId, category: definition.category, provider: { not: provider } }, data: { isDefault: false } });
    return existing ? tx.integration.update({ where: { id: existing.id }, data }) : tx.integration.create({ data: { ...data, organizationId: ctx.organizationId, provider } });
  });
  await audit(ctx, { action: existing ? "integration.updated" : "integration.connected", resourceType: "integration", resourceId: integration.id, metadata: { provider, category: definition.category } });
  return { id: integration.id, provider, status: integration.status };
}

export async function disconnectIntegration(ctx: TenantContext, provider: string) {
  assertCan(ctx, "integrations:manage");
  providerDefinition(provider);
  const existing = await ctx.db.integration.findFirst({ where: { provider } });
  if (!existing) throw new NotFoundError("Integration", provider);
  await ctx.db.integration.update({ where: { id: existing.id }, data: { status: "DISCONNECTED", encryptedCredentials: null, isDefault: false } });
  await audit(ctx, { action: "integration.disconnected", resourceType: "integration", resourceId: existing.id, metadata: { provider } });
  return { provider, status: "DISCONNECTED" as const };
}

/** Sends a harmless test through providers where that's possible without side effects. */
export async function testIntegration(ctx: TenantContext, provider: string): Promise<{ ok: boolean; message: string }> {
  assertCan(ctx, "integrations:manage");
  const existing = await ctx.db.integration.findFirst({ where: { provider, status: "CONNECTED" } });
  if (!existing?.encryptedCredentials) throw new NotFoundError("Integration", provider);
  const secrets = decryptJson<Record<string, string>>(existing.encryptedCredentials);
  let result: { ok: boolean; message: string };
  if (provider === "slack" && secrets.webhookUrl) {
    const response = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "✅ Test message: your workspace is connected to Slack." }) }).catch(() => null);
    result = response?.ok ? { ok: true, message: "Test message posted to Slack." } : { ok: false, message: `Slack rejected the message${response ? ` (HTTP ${response.status})` : ""}.` };
  } else {
    return { ok: true, message: "Saved. It will be used the next time this channel is needed." };
  }
  await ctx.db.integration.update({ where: { id: existing.id }, data: { lastCheckedAt: new Date(), lastError: result.ok ? null : result.message, status: result.ok ? "CONNECTED" : "ERROR" } });
  return result;
}
