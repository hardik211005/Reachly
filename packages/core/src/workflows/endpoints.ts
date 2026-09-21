import { randomBytes } from "node:crypto";
import { EVENT_LABELS } from "@repo/config";
import { prisma, type Event, type Prisma } from "@repo/db";
import { providerFetch, signHmacSha256 } from "@repo/integrations";
import { getQueue } from "@repo/queue";
import { z } from "zod";
import { audit } from "../audit";
import { assertFeature } from "../billing/plans";
import { assertCan, type TenantContext } from "../context";
import { decryptSecret, encryptSecret } from "../crypto";
import { NotFoundError } from "../errors";
import { FANOUT_EVENT_TYPES } from "../events";
import { assertPublicUrl } from "./engine";

/**
 * Outbound webhooks: customers subscribe an HTTPS endpoint to events. Every delivery is
 * signed (`x-reachai-signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`) and retried
 * with backoff by the queue; the delivery log shows every attempt.
 */

const DELIVERY_ATTEMPTS = 6;

export const endpointInputSchema = z.object({
  url: z.url().max(500),
  description: z.string().trim().max(200).nullable().default(null),
  events: z.array(z.string()).min(1).max(30),
});

export function subscribableEvents() {
  return [...FANOUT_EVENT_TYPES].map((type) => ({ type, label: EVENT_LABELS[type] ?? type }));
}

export async function listEndpoints(ctx: TenantContext) {
  assertCan(ctx, "integrations:manage");
  const endpoints = await ctx.db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } });
  const deliveries = endpoints.length
    ? await prisma.webhookDelivery.findMany({ where: { endpointId: { in: endpoints.map((endpoint) => endpoint.id) } }, orderBy: { createdAt: "desc" }, take: 100 })
    : [];
  return endpoints.map(({ encryptedSecret: _secret, ...endpoint }) => ({
    ...endpoint,
    recent: deliveries.filter((delivery) => delivery.endpointId === endpoint.id).slice(0, 10),
  }));
}

export async function createEndpoint(ctx: TenantContext, input: z.input<typeof endpointInputSchema>) {
  assertCan(ctx, "integrations:manage");
  await assertFeature(ctx, "outboundWebhooks");
  const data = endpointInputSchema.parse(input);
  assertPublicUrl(data.url);
  const allowed = new Set<string>(FANOUT_EVENT_TYPES);
  const events = data.events.filter((event) => allowed.has(event));
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const endpoint = await ctx.db.webhookEndpoint.create({ data: { organizationId: ctx.organizationId, url: data.url, description: data.description, events, encryptedSecret: encryptSecret(secret) } });
  await audit(ctx, { action: "webhook_endpoint.created", resourceType: "webhook_endpoint", resourceId: endpoint.id, metadata: { url: data.url, events } });
  // The secret is shown once; afterwards only its encrypted form exists.
  return { id: endpoint.id, url: endpoint.url, events, secret };
}

export async function deleteEndpoint(ctx: TenantContext, id: string) {
  assertCan(ctx, "integrations:manage");
  const endpoint = await ctx.db.webhookEndpoint.findFirst({ where: { id } });
  if (!endpoint) throw new NotFoundError("Webhook endpoint", id);
  await ctx.db.webhookEndpoint.delete({ where: { id } });
  await audit(ctx, { action: "webhook_endpoint.deleted", resourceType: "webhook_endpoint", resourceId: id });
}

function payloadFor(event: Pick<Event, "id" | "type" | "occurredAt" | "leadId" | "campaignId" | "callId" | "dealId" | "channel" | "properties">) {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    data: { leadId: event.leadId, campaignId: event.campaignId, callId: event.callId, dealId: event.dealId, channel: event.channel, properties: event.properties },
  };
}

/** Event subscriber: queue a delivery to every endpoint subscribed to this event. */
export async function fanOutToEndpoints(ctx: TenantContext, event: Event) {
  const endpoints = await ctx.db.webhookEndpoint.findMany({ where: { isActive: true, events: { has: event.type } } });
  for (const endpoint of endpoints) {
    const delivery = await prisma.webhookDelivery.create({ data: { endpointId: endpoint.id, eventType: event.type, payload: payloadFor(event) as Prisma.InputJsonValue } });
    await getQueue().enqueue("webhooks.deliver", { deliveryId: delivery.id }, { jobId: `delivery:${delivery.id}`, attempts: DELIVERY_ATTEMPTS });
  }
  return endpoints.length;
}

/** Job: sends one delivery. Throws on failure so the queue retries with backoff. */
export async function deliverWebhook(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!delivery || delivery.status === "SUCCEEDED") return { skipped: true };
  if (!delivery.endpoint.isActive && delivery.eventType !== "ping") return { skipped: true };
  const body = JSON.stringify(delivery.payload);
  const attempts = delivery.attempts + 1;
  // Test pings are sent once; real deliveries get the queue's retries.
  const maxAttempts = delivery.eventType === "ping" ? 1 : DELIVERY_ATTEMPTS;
  try {
    const response = await providerFetch("webhook", delivery.endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reachai-event": delivery.eventType, "x-reachai-delivery": delivery.id, "x-reachai-signature": signHmacSha256(decryptSecret(delivery.endpoint.encryptedSecret), body, Math.floor(Date.now() / 1000)) },
      body,
      timeoutMs: 10_000,
    });
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "SUCCEEDED", responseCode: response.status, attempts, deliveredAt: new Date(), lastError: null } });
    return { status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    const status = (error as { status?: number | null }).status ?? null;
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: attempts >= maxAttempts ? "FAILED" : "PENDING", responseCode: status, attempts, lastError: message } });
    throw error;
  }
}

export async function sendTestDelivery(ctx: TenantContext, endpointId: string) {
  assertCan(ctx, "integrations:manage");
  const endpoint = await ctx.db.webhookEndpoint.findFirst({ where: { id: endpointId } });
  if (!endpoint) throw new NotFoundError("Webhook endpoint", endpointId);
  const delivery = await prisma.webhookDelivery.create({ data: { endpointId, eventType: "ping", payload: { id: `ping_${Date.now()}`, type: "ping", occurredAt: new Date().toISOString(), data: {} } } });
  await getQueue().enqueue("webhooks.deliver", { deliveryId: delivery.id }, { jobId: `delivery:${delivery.id}`, attempts: 1 });
  return { deliveryId: delivery.id };
}
