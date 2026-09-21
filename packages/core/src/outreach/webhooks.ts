import { getEnv } from "@repo/config/env";
import { prisma, type Prisma } from "@repo/db";
import {
  parseMetaWebhook,
  ResendEmailProvider,
  SendGridEmailProvider,
  verifyMetaWebhook,
  type EmailEvent,
  type EmailProvider,
  type WebhookRequest,
  type WhatsAppEvent,
} from "@repo/integrations";
import { getQueue } from "@repo/queue";
import { systemContext } from "../context";
import { decryptJson, safeEqual } from "../crypto";
import { AppError, NotFoundError } from "../errors";
import { logger } from "../logger";
import { handleDeliveryEvent, handleInboundMessage } from "./inbound";

/**
 * Provider webhooks. Every delivery is signature-verified, stored once (unique on
 * provider + external event id, so retries are idempotent) and processed on a queue.
 */

export class WebhookSignatureError extends AppError {
  constructor(provider: string) {
    super("UNAUTHORIZED", `Invalid ${provider} webhook signature`, 401, { provider });
  }
}

type StoredEvent =
  | { kind: "email"; event: Omit<EmailEvent, "occurredAt"> & { occurredAt: string } }
  | { kind: "whatsapp"; event: (Omit<Extract<WhatsAppEvent, { type: "status" }>, "occurredAt"> | Omit<Extract<WhatsAppEvent, { type: "inbound" }>, "occurredAt">) & { occurredAt: string } };

async function integrationCredentials(integrationId: string) {
  const integration = await prisma.integration.findFirst({ where: { id: integrationId, status: "CONNECTED" } });
  if (!integration) throw new NotFoundError("Integration", integrationId);
  const credentials = integration.encryptedCredentials ? decryptJson<Record<string, string>>(integration.encryptedCredentials) : {};
  return { integration, credentials };
}

async function store(provider: string, organizationId: string | null, eventType: string, externalEventId: string, payload: StoredEvent) {
  try {
    const row = await prisma.webhookEvent.create({
      data: {
        provider,
        externalEventId,
        organizationId,
        eventType,
        signatureValid: true,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: organizationId ? "RECEIVED" : "IGNORED",
        ...(organizationId ? {} : { error: "No matching workspace" }),
      },
    });
    if (organizationId) await getQueue().enqueue("webhooks.process", { webhookEventId: row.id }, { jobId: `webhook:${row.id}` });
    return "accepted" as const;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return "duplicate" as const;
    throw error;
  }
}

/** Finds the workspace a provider event belongs to via the message it references. */
async function organizationForMessage(provider: string, providerMessageId: string | null | undefined, internetMessageId?: string | null) {
  if (providerMessageId) {
    const message = await prisma.message.findFirst({ where: { provider, providerMessageId }, select: { organizationId: true } });
    if (message) return message.organizationId;
  }
  if (internetMessageId) {
    const message = await prisma.message.findFirst({ where: { internetMessageId }, select: { organizationId: true } });
    if (message) return message.organizationId;
  }
  return null;
}

// ----------------------------------------------------------------------------- Email

export async function ingestEmailWebhook(providerName: string, request: WebhookRequest, options: { integrationId?: string | null } = {}) {
  const env = getEnv();
  let provider: EmailProvider;
  let organizationId: string | null = null;
  if (options.integrationId) {
    const { integration, credentials } = await integrationCredentials(options.integrationId);
    if (integration.provider !== providerName) throw new WebhookSignatureError(providerName);
    organizationId = integration.organizationId;
    provider =
      providerName === "resend"
        ? new ResendEmailProvider(credentials.apiKey ?? "", credentials.webhookSecret)
        : new SendGridEmailProvider(credentials.apiKey ?? "", credentials.webhookPublicKey);
  } else if (providerName === "resend") {
    provider = new ResendEmailProvider(env.RESEND_API_KEY ?? "", env.RESEND_WEBHOOK_SECRET);
  } else if (providerName === "sendgrid") {
    provider = new SendGridEmailProvider(env.SENDGRID_API_KEY ?? "", env.SENDGRID_WEBHOOK_PUBLIC_KEY);
  } else {
    throw new NotFoundError("Webhook provider", providerName);
  }
  if (!provider.verifyWebhook?.(request)) throw new WebhookSignatureError(providerName);

  const events = provider.parseWebhook?.(request) ?? [];
  const result = { accepted: 0, duplicates: 0, ignored: 0 };
  for (const event of events) {
    const org = organizationId ?? (await organizationForMessage(providerName, event.providerMessageId, event.inbound?.inReplyTo));
    const outcome = await store(providerName, org, event.type, event.externalEventId, { kind: "email", event: { ...event, occurredAt: event.occurredAt.toISOString() } });
    if (outcome === "duplicate") result.duplicates += 1;
    else if (org) result.accepted += 1;
    else result.ignored += 1;
  }
  return result;
}

// ----------------------------------------------------------------------------- WhatsApp (Meta Cloud API)

/** GET verification handshake when subscribing the webhook in the Meta app dashboard. */
export function verifyWhatsAppSubscription(params: URLSearchParams): string | null {
  const token = getEnv().WHATSAPP_VERIFY_TOKEN;
  if (!token) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!safeEqual(params.get("hub.verify_token") ?? "", token)) return null;
  return params.get("hub.challenge");
}

async function whatsappIntegrationFor(phoneNumberId: string) {
  const integration = await prisma.integration.findFirst({
    where: { category: "WHATSAPP", provider: "meta", status: "CONNECTED", config: { path: ["phoneNumberId"], equals: phoneNumberId } },
  });
  if (!integration) return null;
  const credentials = integration.encryptedCredentials ? decryptJson<Record<string, string>>(integration.encryptedCredentials) : {};
  return { organizationId: integration.organizationId, appSecret: credentials.appSecret ?? null };
}

export async function ingestWhatsAppWebhook(request: WebhookRequest) {
  const env = getEnv();
  const signature = request.headers.get("x-hub-signature-256");
  let parsed: ReturnType<typeof parseMetaWebhook>;
  try {
    parsed = parseMetaWebhook(request.rawBody);
  } catch {
    throw new WebhookSignatureError("whatsapp");
  }
  const { phoneNumberIds, events } = parsed;

  // Per-workspace numbers are verified with that workspace's app secret; the platform number with the env secret.
  const phoneNumberId = phoneNumberIds[0] ?? null;
  const connected = phoneNumberId ? await whatsappIntegrationFor(phoneNumberId) : null;
  const secret = connected?.appSecret ?? env.WHATSAPP_APP_SECRET;
  if (!secret || !verifyMetaWebhook(secret, signature, request.rawBody)) throw new WebhookSignatureError("whatsapp");

  const result = { accepted: 0, duplicates: 0, ignored: 0 };
  for (const event of events) {
    let org = connected?.organizationId ?? null;
    if (!org && event.type === "status") org = await organizationForMessage("meta", event.providerMessageId);
    if (!org && event.type === "inbound") {
      // Shared platform number: attribute the reply to the workspace that last messaged this number.
      const digits = event.from.replace(/\D/g, "");
      const last = await prisma.message.findFirst({
        where: { channel: "WHATSAPP", direction: "OUTBOUND", provider: "meta", toAddress: { endsWith: digits.slice(-10) } },
        orderBy: { sentAt: "desc" },
        select: { organizationId: true },
      });
      org = last?.organizationId ?? null;
    }
    const { occurredAt, ...rest } = event;
    const outcome = await store("meta_whatsapp", org, event.type === "status" ? `status.${event.status}` : "message", event.externalEventId + (event.type === "status" ? `:${event.status}` : ""), {
      kind: "whatsapp",
      event: { ...rest, occurredAt: occurredAt.toISOString() },
    });
    if (outcome === "duplicate") result.duplicates += 1;
    else if (org) result.accepted += 1;
    else result.ignored += 1;
  }
  return result;
}

// ----------------------------------------------------------------------------- Processing

export async function processWebhookEvent(webhookEventId: string) {
  const row = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!row || row.status === "PROCESSED" || !row.organizationId) return { skipped: true };
  const ctx = systemContext(row.organizationId, { type: "PROVIDER", id: row.provider });
  const stored = row.payload as unknown as StoredEvent;
  await prisma.webhookEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  try {
    let outcome: unknown;
    if (stored.kind === "email") {
      const event = stored.event;
      const occurredAt = new Date(event.occurredAt);
      if (event.type === "inbound" && event.inbound) {
        outcome = await handleInboundMessage(ctx, {
          channel: "EMAIL",
          from: event.inbound.from,
          to: event.inbound.to,
          subject: event.inbound.subject,
          body: event.inbound.text,
          provider: row.provider,
          providerMessageId: event.inbound.internetMessageId ?? event.externalEventId,
          inReplyTo: event.inbound.inReplyTo ?? null,
          occurredAt,
        });
      } else if (event.providerMessageId && event.type !== "inbound") {
        outcome = await handleDeliveryEvent(ctx, { provider: row.provider, providerMessageId: event.providerMessageId, event: event.type, occurredAt, reason: event.reason, externalEventId: event.externalEventId });
      }
    } else {
      const event = stored.event;
      const occurredAt = new Date(event.occurredAt);
      if (event.type === "inbound") {
        outcome = await handleInboundMessage(ctx, {
          channel: "WHATSAPP",
          from: event.from,
          body: event.text,
          provider: "meta",
          providerMessageId: event.providerMessageId,
          occurredAt,
        });
      } else if (event.status !== "sent") {
        outcome = await handleDeliveryEvent(ctx, {
          provider: "meta",
          providerMessageId: event.providerMessageId,
          event: event.status === "read" ? "read" : event.status === "failed" ? "failed" : "delivered",
          occurredAt,
          reason: event.error,
          externalEventId: `${event.externalEventId}:${event.status}`,
        });
      }
    }
    await prisma.webhookEvent.update({ where: { id: row.id }, data: { status: "PROCESSED", processedAt: new Date(), error: null } });
    return outcome ?? { ignored: true };
  } catch (error) {
    logger.error({ err: error, webhookEventId }, "webhook processing failed");
    await prisma.webhookEvent.update({ where: { id: row.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : String(error) } });
    throw error;
  }
}
