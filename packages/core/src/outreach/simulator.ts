import { createHash, randomUUID } from "node:crypto";
import type { Channel } from "@repo/db";
import { getQueue } from "@repo/queue";
import { systemContext, type TenantContext } from "../context";
import { handleDeliveryEvent, handleInboundMessage } from "./inbound";

/**
 * Demo-mode provider simulator. When a message goes out through a MOCK provider, this
 * schedules the events a real provider would send (delivery, opens/reads, sometimes a
 * reply) and feeds them through the same handlers as real webhooks. Every simulated
 * event is flagged `simulated` and only runs with DEMO_MODE + DEMO_SIMULATE_EVENTS.
 */

function unit(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0) / 0xffffffff;
}

const REPLIES: Array<{ weight: number; texts: string[] }> = [
  { weight: 30, texts: ["Hi, this sounds interesting. Can you tell me a bit more about how it would work for us?", "Thanks for reaching out — yes, we've been meaning to look into this. Send me more details."] },
  { weight: 20, texts: ["Sure, happy to talk. Would Thursday afternoon work?", "Let's set up a call — I'm free tomorrow after 3pm."] },
  { weight: 15, texts: ["What would this cost for us? We have a few outlets.", "Can you share pricing and minimum order details?"] },
  { weight: 15, texts: ["Thanks, but we're busy until after the festive season. Maybe next month.", "Not right now, circle back next quarter."] },
  { weight: 10, texts: ["Thanks, but we're not interested at the moment.", "We're all set on this, thank you."] },
  { weight: 5, texts: ["Please remove us from your list.", "Stop messaging this number please."] },
  { weight: 5, texts: ["Do you already work with other businesses in our area?", "Is this something you do across NCR?"] },
];

function pickReply(seed: string): string {
  const total = REPLIES.reduce((sum, reply) => sum + reply.weight, 0);
  let roll = unit(`${seed}:intent`) * total;
  for (const reply of REPLIES) {
    roll -= reply.weight;
    if (roll <= 0) return reply.texts[Math.floor(unit(`${seed}:text`) * reply.texts.length)] ?? reply.texts[0] ?? "";
  }
  return REPLIES[0]?.texts[0] ?? "";
}

export async function scheduleSimulation(ctx: TenantContext, messageId: string, channel: Channel) {
  if (channel !== "EMAIL" && channel !== "WHATSAPP") return;
  const kind = channel === "EMAIL" ? "email" : "whatsapp";
  const queue = getQueue();
  const job = (step: string, delayMs: number) =>
    queue.enqueue("demo.simulate", { organizationId: ctx.organizationId, kind, refId: messageId, step }, { jobId: `sim:${messageId}:${step}`, delayMs });

  await job("delivered", 3_000 + unit(`${messageId}:d`) * 5_000);
  const opens = unit(`${messageId}:o`) < (kind === "email" ? 0.62 : 0.85);
  if (opens) await job("opened", 20_000 + unit(`${messageId}:ot`) * 40_000);
  const replies = opens && unit(`${messageId}:r`) < (kind === "email" ? 0.45 : 0.5);
  if (replies) await job("reply", 45_000 + unit(`${messageId}:rt`) * 90_000);
}

/** Registered by the calls module so simulated AI calls run through the same pipeline. */
export type CallSimulator = (ctx: TenantContext, callId: string, step: string) => Promise<unknown>;
let callSimulator: CallSimulator | null = null;
export function registerCallSimulator(simulator: CallSimulator): void {
  callSimulator = simulator;
}

export async function runSimulationStep(input: { organizationId: string; kind: "email" | "whatsapp" | "call"; refId: string; step: string }) {
  const ctx = systemContext(input.organizationId, { type: "PROVIDER", id: "mock" });
  if (input.kind === "call") {
    return callSimulator ? callSimulator(ctx, input.refId, input.step) : { skipped: "call simulator not registered" };
  }
  const message = await ctx.db.message.findFirst({ where: { id: input.refId }, include: { lead: { select: { id: true } } } });
  if (!message?.providerMessageId || !message.provider) return { skipped: "message not sent" };
  if (input.step === "delivered") {
    return handleDeliveryEvent(ctx, { provider: message.provider, providerMessageId: message.providerMessageId, event: "delivered", externalEventId: `sim:${message.id}:delivered`, simulated: true });
  }
  if (input.step === "opened") {
    return handleDeliveryEvent(ctx, { provider: message.provider, providerMessageId: message.providerMessageId, event: input.kind === "email" ? "opened" : "read", externalEventId: `sim:${message.id}:opened`, simulated: true });
  }
  if (input.step === "reply") {
    return handleInboundMessage(ctx, {
      channel: message.channel as "EMAIL" | "WHATSAPP",
      from: message.toAddress ?? "unknown",
      to: message.fromAddress,
      subject: message.subject ? `Re: ${message.subject.replace(/^Re:\s*/i, "")}` : null,
      body: pickReply(message.id),
      provider: "mock",
      providerMessageId: `mock_in_${randomUUID()}`,
      inReplyTo: message.internetMessageId,
      simulated: true,
      leadId: message.lead.id,
    });
  }
  return { skipped: `unknown step ${input.step}` };
}
