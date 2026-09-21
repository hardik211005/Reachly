import { POSITIVE_INTENTS, REPLY_INTENT_LABELS } from "@repo/config";
import type { Channel, Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { conversationAnalysisAgent, analyzeConversationDeterministically } from "../ai/agents/conversation-analysis";
import { runAgent } from "../ai/service";
import { addSuppression } from "../compliance/suppression";
import type { TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { normalizeEmail, normalizePhone } from "../leads/normalize";
import { notify } from "../notifications";
import { pricingFacts } from "./context";
import { findOrCreateConversation } from "./conversations";

// ----------------------------------------------------------------------------- Inbound messages

export interface InboundMessageInput {
  channel: Extract<Channel, "EMAIL" | "WHATSAPP">;
  from: string;
  to?: string | null;
  subject?: string | null;
  body: string;
  provider: string;
  providerMessageId: string;
  inReplyTo?: string | null;
  occurredAt?: Date;
  simulated?: boolean;
  /** Set when the caller already knows the lead (simulator, tests). */
  leadId?: string;
}

async function matchLead(ctx: TenantContext, input: InboundMessageInput): Promise<{ leadId: string; contactId: string | null } | null> {
  if (input.leadId) return { leadId: input.leadId, contactId: null };
  if (input.channel === "EMAIL") {
    if (input.inReplyTo) {
      const original = await ctx.db.message.findFirst({ where: { internetMessageId: input.inReplyTo }, select: { leadId: true } });
      if (original) return { leadId: original.leadId, contactId: null };
    }
    const email = normalizeEmail(input.from.replace(/^.*<|>.*$/g, ""));
    if (!email) return null;
    const contact = await ctx.db.contact.findFirst({ where: { email, deletedAt: null }, select: { id: true, leadId: true } });
    if (contact) return { leadId: contact.leadId, contactId: contact.id };
    const lead = await ctx.db.lead.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    return lead ? { leadId: lead.id, contactId: null } : null;
  }
  const phone = normalizePhone(input.from);
  if (!phone) return null;
  const contact = await ctx.db.contact.findFirst({ where: { OR: [{ whatsapp: phone }, { phone }], deletedAt: null }, select: { id: true, leadId: true } });
  if (contact) return { leadId: contact.leadId, contactId: contact.id };
  const lead = await ctx.db.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
  return lead ? { leadId: lead.id, contactId: null } : null;
}

/**
 * Stores an inbound reply, stops the lead's running sequences (a reply always ends
 * automated follow-ups), and queues AI analysis. Idempotent per provider message id.
 */
export async function handleInboundMessage(ctx: TenantContext, input: InboundMessageInput) {
  const duplicate = await ctx.db.message.findFirst({ where: { provider: input.provider, providerMessageId: input.providerMessageId }, select: { id: true } });
  if (duplicate) return { messageId: duplicate.id, duplicate: true };

  const match = await matchLead(ctx, input);
  if (!match) {
    logger.info({ channel: input.channel, provider: input.provider }, "inbound message from unknown sender ignored");
    return { messageId: null, duplicate: false, unmatched: true };
  }
  const occurredAt = input.occurredAt ?? new Date();
  const lead = await ctx.db.lead.findFirst({ where: { id: match.leadId }, select: { id: true, status: true, name: true } });
  if (!lead) throw new NotFoundError("Lead", match.leadId);

  const conversation = await findOrCreateConversation(ctx, { leadId: lead.id, channel: input.channel, contactId: match.contactId });
  const message = await ctx.db.message.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: lead.id,
      campaignId: conversation.campaignId,
      channel: input.channel,
      direction: "INBOUND",
      status: "RECEIVED",
      subject: input.subject ?? null,
      body: input.body.slice(0, 20_000),
      fromAddress: input.from,
      toAddress: input.to ?? null,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      inReplyTo: input.inReplyTo ?? null,
      metadata: { simulated: Boolean(input.simulated) } as Prisma.InputJsonValue,
      createdAt: occurredAt,
    },
  });

  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: occurredAt, lastInboundAt: occurredAt, unreadCount: { increment: 1 }, status: "NEEDS_RESPONSE" },
  });
  await recordEvent(ctx, {
    type: input.channel === "EMAIL" ? "email_replied" : "whatsapp_received",
    occurredAt,
    leadId: lead.id,
    campaignId: conversation.campaignId,
    conversationId: conversation.id,
    messageId: message.id,
    channel: input.channel,
    actor: { type: "PROVIDER", id: input.provider },
    properties: { simulated: Boolean(input.simulated) },
    idempotencyKey: `inbound:${input.provider}:${input.providerMessageId}`,
  });

  // A reply stops every running sequence for this lead and cancels queued follow-ups.
  const active = await ctx.db.campaignLead.findMany({ where: { leadId: lead.id, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } } });
  if (active.length) {
    await ctx.db.campaignLead.updateMany({ where: { id: { in: active.map((row) => row.id) } }, data: { status: "REPLIED", nextActionAt: null, stoppedReason: "Lead replied" } });
    await ctx.db.message.updateMany({
      where: { leadId: lead.id, direction: "OUTBOUND", campaignStepId: { not: null }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } },
      data: { status: "CANCELED", error: "Lead replied — follow-up cancelled" },
    });
    for (const row of active) {
      await recordEvent(ctx, { type: "sequence_stopped", leadId: lead.id, campaignId: row.campaignId, properties: { reason: "Lead replied" } });
    }
  }
  if (["NEW", "QUALIFIED", "CONTACTED"].includes(lead.status)) {
    await ctx.db.lead.update({ where: { id: lead.id }, data: { status: "REPLIED" } });
    await recordEvent(ctx, { type: "lead_status_changed", leadId: lead.id, properties: { from: lead.status, to: "REPLIED", toLabel: "Replied", reason: "Inbound reply" } });
  }

  await getQueue().enqueue("conversations.analyze-inbound", { organizationId: ctx.organizationId, messageId: message.id }, { jobId: `analyze:${message.id}` });
  return { messageId: message.id, duplicate: false };
}

// ----------------------------------------------------------------------------- AI analysis

export async function analyzeInboundMessage(ctx: TenantContext, messageId: string) {
  const message = await ctx.db.message.findFirst({ where: { id: messageId }, include: { lead: true, conversation: { include: { campaign: true } } } });
  if (!message || message.direction !== "INBOUND") return null;
  const [thread, compliance, offerings] = await Promise.all([
    ctx.db.message.findMany({ where: { conversationId: message.conversationId, createdAt: { lte: message.createdAt } }, orderBy: { createdAt: "asc" }, take: 12 }),
    ctx.db.complianceSettings.findFirst(),
    ctx.db.offering.findMany({ where: { deletedAt: null, isActive: true } }),
  ]);
  const input = {
    channel: message.channel as "EMAIL" | "WHATSAPP",
    leadName: message.lead.name,
    sellerName: "",
    offer: message.conversation.campaign?.offerSummary ?? offerings[0]?.name ?? null,
    messages: thread.map((item) => ({ direction: item.direction, body: item.body.slice(0, 2000) })),
    optOutKeywords: compliance?.optOutKeywords ?? [],
    pricingFacts: pricingFacts(offerings),
  };

  // Deterministic opt-out detection runs first as a safety net: an opt-out is honoured
  // even if the AI provider is unavailable or misclassifies it.
  const safety = analyzeConversationDeterministically(input);
  let analysis = safety;
  try {
    analysis = (await runAgent(ctx, conversationAnalysisAgent, input, { leadId: message.leadId, campaignId: message.campaignId })).output;
  } catch (error) {
    logger.warn({ err: error, messageId }, "AI reply analysis failed; using deterministic classification");
  }
  if (safety.optOut && !analysis.optOut) analysis = { ...analysis, optOut: true, intent: "OPT_OUT", suggestedReply: null };

  await ctx.db.message.update({ where: { id: message.id }, data: { intent: analysis.intent, sentiment: analysis.sentiment } });
  await ctx.db.conversation.update({
    where: { id: message.conversationId },
    data: { aiSummary: analysis.summary, aiIntent: analysis.intent, aiSentiment: analysis.sentiment, suggestedReply: analysis.suggestedReply },
  });
  await recordEvent(ctx, {
    type: "reply_classified",
    leadId: message.leadId,
    campaignId: message.campaignId,
    conversationId: message.conversationId,
    messageId: message.id,
    channel: message.channel,
    actor: { type: "AI" },
    properties: { intent: analysis.intent, sentiment: analysis.sentiment, optOut: analysis.optOut },
    idempotencyKey: `classified:${message.id}`,
  });

  if (analysis.optOut) {
    await addSuppression(ctx, { leadId: message.leadId, email: message.channel === "EMAIL" ? message.fromAddress : null, phone: message.channel === "WHATSAPP" ? message.fromAddress : null }, {
      reason: "OPT_OUT",
      sourceType: "reply",
      sourceId: message.id,
      note: message.body.slice(0, 200),
    });
    await ctx.db.conversation.update({ where: { id: message.conversationId }, data: { status: "CLOSED" } });
    return analysis;
  }

  if ((POSITIVE_INTENTS as readonly string[]).includes(analysis.intent)) {
    if (["REPLIED", "CONTACTED", "QUALIFIED", "NEW"].includes(message.lead.status)) {
      await ctx.db.lead.update({ where: { id: message.leadId }, data: { status: "INTERESTED" } });
      await recordEvent(ctx, { type: "lead_status_changed", leadId: message.leadId, properties: { from: message.lead.status, to: "INTERESTED", toLabel: "Interested", reason: REPLY_INTENT_LABELS[analysis.intent] } });
    }
    await notify(ctx, {
      type: "reply.positive",
      title: `${message.lead.name} replied: ${REPLY_INTENT_LABELS[analysis.intent].toLowerCase()}`,
      body: analysis.summary,
      link: `/app/conversations?status=all&c=${message.conversationId}`,
      metadata: { leadId: message.leadId, intent: analysis.intent },
    });
  }
  if (analysis.meetingRequested || analysis.intent === "NOT_NOW") {
    const { createTask } = await import("../crm/tasks");
    await createTask(ctx, {
      title: analysis.meetingRequested ? `Schedule a meeting with ${message.lead.name}` : `Check back with ${message.lead.name}`,
      type: analysis.meetingRequested ? "MEETING" : "FOLLOW_UP",
      priority: analysis.meetingRequested ? "HIGH" : "LOW",
      dueAt: new Date(Date.now() + (analysis.meetingRequested ? 1 : 30) * 86_400_000),
      leadId: message.leadId,
      description: analysis.summary,
    });
  }
  return analysis;
}

// ----------------------------------------------------------------------------- Provider status events

export type DeliveryEvent = "delivered" | "opened" | "clicked" | "read" | "bounced" | "complained" | "failed" | "unsubscribed";

export async function handleDeliveryEvent(
  ctx: TenantContext,
  input: { provider: string; providerMessageId: string; event: DeliveryEvent; occurredAt?: Date; reason?: string; externalEventId: string; simulated?: boolean },
) {
  const message = await ctx.db.message.findFirst({ where: { provider: input.provider, providerMessageId: input.providerMessageId } });
  if (!message) return { matched: false };
  const at = input.occurredAt ?? new Date();
  const email = message.channel === "EMAIL";
  const base = { leadId: message.leadId, campaignId: message.campaignId, messageId: message.id, conversationId: message.conversationId, channel: message.channel, occurredAt: at, actor: { type: "PROVIDER" as const, id: input.provider } };
  const key = `${input.provider}:${input.externalEventId}`;

  switch (input.event) {
    case "delivered":
      await ctx.db.message.update({ where: { id: message.id }, data: { status: message.status === "SENT" ? "DELIVERED" : message.status, deliveredAt: message.deliveredAt ?? at } });
      await recordEvent(ctx, { ...base, type: email ? "email_delivered" : "whatsapp_delivered", idempotencyKey: `delivered:${key}`, properties: { simulated: Boolean(input.simulated) } });
      break;
    case "opened":
    case "read":
      await ctx.db.message.update({ where: { id: message.id }, data: email ? { openedAt: message.openedAt ?? at } : { status: "READ", readAt: message.readAt ?? at } });
      if (email ? !message.openedAt : !message.readAt) {
        await recordEvent(ctx, { ...base, type: email ? "email_opened" : "whatsapp_read", idempotencyKey: `open:${message.id}`, properties: { simulated: Boolean(input.simulated) } });
      }
      break;
    case "clicked":
      await recordEvent(ctx, { ...base, type: "email_clicked", idempotencyKey: `click:${key}` });
      break;
    case "bounced":
    case "complained":
    case "failed": {
      await ctx.db.message.update({ where: { id: message.id }, data: { status: input.event === "failed" ? "FAILED" : "BOUNCED", failedAt: at, error: input.reason ?? input.event } });
      await recordEvent(ctx, { ...base, type: email ? (input.event === "failed" ? "email_failed" : "email_bounced") : "whatsapp_failed", idempotencyKey: `fail:${key}`, properties: { reason: input.reason ?? null } });
      if (input.event !== "failed" && message.toAddress) {
        await addSuppression(ctx, email ? { email: message.toAddress } : { phone: message.toAddress }, {
          reason: input.event === "bounced" ? "BOUNCE" : "COMPLAINT",
          channel: message.channel,
          sourceType: "provider_event",
          sourceId: message.id,
        });
      }
      break;
    }
    case "unsubscribed":
      await addSuppression(ctx, { leadId: message.leadId, email: message.toAddress }, { reason: "UNSUBSCRIBE", sourceType: "provider_event", sourceId: message.id });
      await recordEvent(ctx, { ...base, type: "email_unsubscribed", idempotencyKey: `unsub:${key}` });
      break;
  }
  return { matched: true };
}
