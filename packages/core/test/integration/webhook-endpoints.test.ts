import { prisma } from "@repo/db";
import { verifyHmacSha256 } from "@repo/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureNotInPlanError } from "../../src/errors";
import { recordEvent } from "../../src/events";
import { createEndpoint, deliverWebhook, fanOutToEndpoints, listEndpoints, sendTestDelivery } from "../../src/workflows/endpoints";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Replaces fetch with a receiver that answers with the given statuses in order. */
function receiver(statuses: number[]) {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 200;
    return new Response(status >= 400 ? "nope" : "ok", { status });
  });
  return calls;
}

async function setup(plan = "scale") {
  const workspace = await createWorkspace("Hooks Co");
  await setPlan(workspace.organizationId, plan);
  return workspace;
}

describe("outbound webhooks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers subscribed events, signed with the endpoint's secret", async () => {
    const { ctx } = await setup();
    const endpoint = await createEndpoint(ctx, { url: "https://hooks.example.com/reachai", events: ["meeting_created", "not_a_real_event"] });
    expect(endpoint.events).toEqual(["meeting_created"]);
    expect(endpoint.secret).toMatch(/^whsec_/);

    const lead = await createLead(ctx, { name: "Signal Cafe" });
    const event = await recordEvent(ctx, { type: "meeting_created", leadId: lead.id, properties: { source: "call" } });
    const ignored = await recordEvent(ctx, { type: "lead_created", leadId: lead.id });
    expect(await fanOutToEndpoints(ctx, event!)).toBe(1);
    expect(await fanOutToEndpoints(ctx, ignored!)).toBe(0);

    const calls = receiver([200]);
    const [delivery] = (await listEndpoints(ctx))[0]!.recent;
    await deliverWebhook(delivery!.id);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.headers["x-reachai-event"]).toBe("meeting_created");
    expect(verifyHmacSha256(endpoint.secret, call.headers["x-reachai-signature"] ?? null, call.body)).toBe(true);
    expect(verifyHmacSha256("whsec_wrong", call.headers["x-reachai-signature"] ?? null, call.body)).toBe(false);
    expect(JSON.parse(call.body)).toMatchObject({ id: event!.id, type: "meeting_created", data: { leadId: lead.id, properties: { source: "call" } } });

    // The secret is never returned again.
    expect(JSON.stringify(await listEndpoints(ctx))).not.toContain(endpoint.secret);
    // A delivered webhook isn't sent twice when the job is retried.
    await deliverWebhook(delivery!.id);
    expect(calls).toHaveLength(1);
  });

  it("keeps failed deliveries retryable until the last attempt", async () => {
    const { ctx } = await setup();
    await createEndpoint(ctx, { url: "https://hooks.example.com/down", events: ["opt_out"] });
    const event = await recordEvent(ctx, { type: "opt_out", properties: { channel: "EMAIL" } });
    await fanOutToEndpoints(ctx, event!);
    const [delivery] = (await listEndpoints(ctx))[0]!.recent;

    receiver([503, 503, 200]);
    await expect(deliverWebhook(delivery!.id)).rejects.toThrow(/503/);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery!.id } })).toMatchObject({ status: "PENDING", attempts: 1, responseCode: 503 });
    await expect(deliverWebhook(delivery!.id)).rejects.toThrow();
    await deliverWebhook(delivery!.id);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery!.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 3, lastError: null });
  });

  it("test pings are sent once and fail visibly", async () => {
    const { ctx } = await setup();
    const endpoint = await createEndpoint(ctx, { url: "https://hooks.example.com/ping", events: ["opt_out"] });
    const { deliveryId } = await sendTestDelivery(ctx, endpoint.id);
    receiver([500]);
    await expect(deliverWebhook(deliveryId)).rejects.toThrow();
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({ status: "FAILED", attempts: 1 });
  });

  it("needs the Scale plan", async () => {
    const { ctx } = await setup("pro");
    await expect(createEndpoint(ctx, { url: "https://hooks.example.com/x", events: ["opt_out"] })).rejects.toBeInstanceOf(FeatureNotInPlanError);
  });
});
