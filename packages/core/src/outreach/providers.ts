import { brand } from "@repo/config";
import { getEnv } from "@repo/config/env";
import {
  MetaWhatsAppProvider,
  MockEmailProvider,
  MockWhatsAppProvider,
  ResendEmailProvider,
  SendGridEmailProvider,
  SmtpEmailProvider,
  type EmailProvider,
  type WhatsAppProvider,
} from "@repo/integrations";
import type { TenantContext } from "../context";
import { ProviderNotConfiguredError } from "../errors";
import { getConnectedIntegration } from "../integrations/credentials";

/**
 * Outreach providers per organisation. Resolution order:
 * connected integration → platform env → mock (DEMO_MODE only) → ProviderNotConfiguredError.
 */

export interface ResolvedEmail {
  provider: EmailProvider;
  from: string;
  replyTo: string | null;
}

type GlobalWithMocks = typeof globalThis & { __reachMockEmail?: MockEmailProvider; __reachMockWhatsApp?: MockWhatsAppProvider };

function mockEmail(): MockEmailProvider {
  const g = globalThis as GlobalWithMocks;
  g.__reachMockEmail ??= new MockEmailProvider();
  return g.__reachMockEmail;
}

function mockWhatsApp(): MockWhatsAppProvider {
  const g = globalThis as GlobalWithMocks;
  g.__reachMockWhatsApp ??= new MockWhatsAppProvider();
  return g.__reachMockWhatsApp;
}

function emailFromIntegration(provider: string, credentials: Record<string, string>): EmailProvider | null {
  switch (provider) {
    case "resend":
      return credentials.apiKey ? new ResendEmailProvider(credentials.apiKey, credentials.webhookSecret) : null;
    case "sendgrid":
      return credentials.apiKey ? new SendGridEmailProvider(credentials.apiKey, credentials.webhookPublicKey) : null;
    case "smtp":
      return credentials.host
        ? new SmtpEmailProvider({ host: credentials.host, port: Number(credentials.port ?? 587), secure: credentials.secure === "true", user: credentials.user, password: credentials.password })
        : null;
    default:
      return null;
  }
}

export async function resolveEmailProvider(ctx: TenantContext): Promise<ResolvedEmail> {
  const env = getEnv();
  const org = await ctx.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } });
  const displayName = (org?.name ?? brand.name).replace(/[<>"]/g, "");

  const integration = await getConnectedIntegration(ctx, "EMAIL");
  if (integration) {
    const provider = emailFromIntegration(integration.provider, integration.credentials);
    if (provider) {
      const fromEmail = (integration.config.fromEmail as string | undefined) ?? env.EMAIL_FROM.replace(/^.*<|>$/g, "");
      return {
        provider,
        from: `${(integration.config.fromName as string | undefined) ?? displayName} <${fromEmail}>`,
        replyTo: (integration.config.replyTo as string | undefined) ?? null,
      };
    }
  }

  const address = env.EMAIL_FROM.includes("<") ? env.EMAIL_FROM.replace(/^.*<|>$/g, "") : env.EMAIL_FROM;
  const from = `${displayName} <${address}>`;
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return { provider: new ResendEmailProvider(env.RESEND_API_KEY, env.RESEND_WEBHOOK_SECRET), from, replyTo: null };
  if (env.EMAIL_PROVIDER === "sendgrid" && env.SENDGRID_API_KEY) return { provider: new SendGridEmailProvider(env.SENDGRID_API_KEY, env.SENDGRID_WEBHOOK_PUBLIC_KEY), from, replyTo: null };
  if (env.EMAIL_PROVIDER === "smtp" && env.SMTP_HOST) {
    return {
      provider: new SmtpEmailProvider({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, password: env.SMTP_PASSWORD }),
      from,
      replyTo: null,
    };
  }
  if (env.DEMO_MODE) return { provider: mockEmail(), from, replyTo: null };
  throw new ProviderNotConfiguredError("email");
}

export async function resolveWhatsAppProvider(ctx: TenantContext): Promise<WhatsAppProvider> {
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "WHATSAPP", "meta");
  if (integration?.credentials.accessToken && integration.config.phoneNumberId) {
    return new MetaWhatsAppProvider({
      accessToken: integration.credentials.accessToken,
      phoneNumberId: String(integration.config.phoneNumberId),
      businessAccountId: integration.config.businessAccountId ? String(integration.config.businessAccountId) : undefined,
      apiVersion: env.WHATSAPP_GRAPH_API_VERSION,
    });
  }
  if (env.WHATSAPP_PROVIDER === "meta" && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    return new MetaWhatsAppProvider({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      apiVersion: env.WHATSAPP_GRAPH_API_VERSION,
    });
  }
  if (env.DEMO_MODE) return mockWhatsApp();
  throw new ProviderNotConfiguredError("WhatsApp");
}

/** Whether a channel can currently send at all (used for launch checks and UI states). */
export async function channelAvailability(ctx: TenantContext) {
  const [email, whatsapp] = await Promise.all([
    resolveEmailProvider(ctx).then((resolved) => ({ ok: true as const, provider: resolved.provider.name, simulated: resolved.provider.isMock })).catch(() => ({ ok: false as const })),
    resolveWhatsAppProvider(ctx).then((provider) => ({ ok: true as const, provider: provider.name, simulated: provider.isMock })).catch(() => ({ ok: false as const })),
  ]);
  return { EMAIL: email, WHATSAPP: whatsapp };
}
