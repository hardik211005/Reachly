import { CONVERSATION_STATUSES, REPLY_INTENTS } from "@repo/config";
import type { Prisma } from "@repo/db";
import { z } from "zod";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";
import { primaryContact } from "./context";
import { findOrCreateConversation, whatsappWindowOpen } from "./conversations";
import { channelAvailability } from "./providers";
import { queueSend } from "./send";

/** Unified inbox: email + WhatsApp conversations (calls attach to conversations too). */

export const inboxFiltersSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP", "VOICE"]).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  intent: z.enum(REPLY_INTENTS).optional(),
  campaignId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
  unread: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type InboxFilters = z.input<typeof inboxFiltersSchema>;

export async function listConversations(ctx: TenantContext, filters: InboxFilters = {}) {
  assertCan(ctx, "conversations:read");
  const input = inboxFiltersSchema.parse(filters);
  const base: Prisma.ConversationWhereInput = {
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.leadId ? { leadId: input.leadId } : {}),
    ...(input.intent ? { aiIntent: input.intent } : {}),
    ...(input.unread ? { unreadCount: { gt: 0 } } : {}),
    ...(input.q
      ? {
          OR: [
            { lead: { name: { contains: input.q, mode: "insensitive" } } },
            { subject: { contains: input.q, mode: "insensitive" } },
            { messages: { some: { body: { contains: input.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    lead: { deletedAt: null },
    lastMessageAt: { not: null },
  };
  const where: Prisma.ConversationWhereInput = { ...base, ...(input.status ? { status: input.status } : {}) };
  const [rows, counts] = await Promise.all([
    ctx.db.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: {
        lead: { select: { id: true, name: true, category: true, city: true, locality: true, score: true, status: true, website: true } },
        campaign: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, direction: true, body: true, subject: true, status: true, createdAt: true, channel: true } },
      },
    }),
    ctx.db.conversation.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const items = rows.slice(0, input.limit).map(({ messages, ...conversation }) => ({ ...conversation, lastMessage: messages[0] ?? null }));
  return {
    items,
    nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Partial<Record<(typeof CONVERSATION_STATUSES)[number], number>>,
  };
}

export async function getConversation(ctx: TenantContext, id: string) {
  assertCan(ctx, "conversations:read");
  const conversation = await ctx.db.conversation.findFirst({
    where: { id },
    include: {
      lead: {
        select: {
          id: true, name: true, category: true, city: true, locality: true, score: true, status: true, website: true, email: true, phone: true,
          doNotContact: true, sourceProvider: true, rating: true, reviewCount: true,
          contacts: { where: { deletedAt: null }, select: { id: true, name: true, title: true, email: true, phone: true, whatsapp: true, whatsappOptIn: true, isPrimary: true, kind: true } },
        },
      },
      contact: { select: { id: true, name: true, title: true } },
      campaign: { select: { id: true, name: true, status: true, automationMode: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200, include: { campaignStep: { select: { name: true } } } },
      calls: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, outcome: true, durationSeconds: true, summary: true, createdAt: true } },
    },
  });
  if (!conversation) throw new NotFoundError("Conversation", id);
  const availability = await channelAvailability(ctx);
  return {
    ...conversation,
    whatsappWindowOpen: conversation.channel === "WHATSAPP" ? whatsappWindowOpen(conversation.lastInboundAt) : null,
    provider: conversation.channel === "EMAIL" || conversation.channel === "WHATSAPP" ? availability[conversation.channel] : null,
  };
}

export async function markConversationRead(ctx: TenantContext, id: string) {
  assertCan(ctx, "conversations:read");
  const { count } = await ctx.db.conversation.updateMany({ where: { id, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } });
  return { updated: count };
}

export async function setConversationStatus(ctx: TenantContext, id: string, status: "OPEN" | "CLOSED") {
  assertCan(ctx, "outreach:send");
  const conversation = await ctx.db.conversation.findFirst({ where: { id } });
  if (!conversation) throw new NotFoundError("Conversation", id);
  return ctx.db.conversation.update({ where: { id }, data: { status, ...(status === "CLOSED" ? { unreadCount: 0 } : {}) } });
}

export const replySchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(5000),
  subject: z.string().trim().max(200).optional(),
});

/** A human reply from the inbox. It goes through the same send pipeline (and checks) as automated messages. */
export async function replyToConversation(ctx: TenantContext, id: string, input: z.input<typeof replySchema>) {
  assertCan(ctx, "outreach:send");
  const { body, subject } = replySchema.parse(input);
  const conversation = await ctx.db.conversation.findFirst({
    where: { id },
    include: {
      lead: { include: { contacts: { where: { deletedAt: null } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 20, select: { direction: true, fromAddress: true, toAddress: true, subject: true } },
    },
  });
  if (!conversation) throw new NotFoundError("Conversation", id);
  if (conversation.channel !== "EMAIL" && conversation.channel !== "WHATSAPP") throw new PreconditionError("Replies are only possible on email and WhatsApp conversations");
  if (conversation.channel === "WHATSAPP" && !whatsappWindowOpen(conversation.lastInboundAt)) {
    throw new PreconditionError("WhatsApp only allows free-form replies within 24 hours of the customer's last message. Use an approved template instead.");
  }
  const lastInbound = conversation.messages.find((message) => message.direction === "INBOUND");
  const lastOutbound = conversation.messages.find((message) => message.direction === "OUTBOUND");
  const contactChannel = conversation.channel === "EMAIL" ? "EMAIL" : "WHATSAPP";
  const contact = primaryContact(conversation.lead.contacts, contactChannel);
  const to =
    lastInbound?.fromAddress ??
    lastOutbound?.toAddress ??
    (conversation.channel === "EMAIL" ? (contact?.email ?? conversation.lead.email) : (contact?.whatsapp ?? contact?.phone ?? conversation.lead.phone));
  if (!to) throw new PreconditionError("This lead has no address on this channel");
  const threadSubject = subject ?? (conversation.subject ? `Re: ${conversation.subject.replace(/^(re:\s*)+/i, "")}` : null);

  const now = new Date();
  const message = await ctx.db.message.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      campaignId: conversation.campaignId,
      channel: conversation.channel,
      direction: "OUTBOUND",
      status: "APPROVED",
      subject: conversation.channel === "EMAIL" ? (threadSubject ?? `Following up — ${conversation.lead.name}`) : null,
      body,
      toAddress: to,
      approvedById: ctx.userId,
      approvedAt: now,
      createdById: ctx.userId,
      metadata: { manual: true },
    },
  });
  await ctx.db.conversation.update({ where: { id: conversation.id }, data: { unreadCount: 0, status: "AWAITING_REPLY", suggestedReply: null } });
  await queueSend(ctx, message.id);
  return message;
}

export const directMessageSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(5000),
  sendNow: z.boolean().default(true),
});

/** One-off message from the lead workspace (outside any campaign). */
export async function sendDirectMessage(ctx: TenantContext, leadId: string, input: z.input<typeof directMessageSchema>) {
  assertCan(ctx, "outreach:send");
  const data = directMessageSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  if (lead.doNotContact) throw new PreconditionError("This lead is marked do-not-contact");
  const contact = primaryContact(lead.contacts, data.channel);
  const to = data.channel === "EMAIL" ? (contact?.email ?? lead.email) : (contact?.whatsapp ?? contact?.phone ?? lead.phone);
  if (!to) throw new PreconditionError(data.channel === "EMAIL" ? "This lead has no email address" : "This lead has no WhatsApp number");
  if (data.channel === "EMAIL" && !data.subject) throw new PreconditionError("Add a subject line");
  const conversation = await findOrCreateConversation(ctx, { leadId, channel: data.channel, contactId: contact?.id ?? null, subject: data.subject ?? null });
  if (data.channel === "WHATSAPP" && data.sendNow && !whatsappWindowOpen(conversation.lastInboundAt)) {
    throw new PreconditionError("WhatsApp only allows free-form messages within 24 hours of the customer's last message. Start the conversation with an approved template from a campaign.");
  }
  const now = new Date();
  const message = await ctx.db.message.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId,
      channel: data.channel,
      direction: "OUTBOUND",
      status: data.sendNow ? "APPROVED" : "DRAFT",
      subject: data.subject ?? null,
      body: data.body,
      toAddress: to,
      createdById: ctx.userId,
      ...(data.sendNow ? { approvedById: ctx.userId, approvedAt: now } : {}),
      metadata: { manual: true },
    },
  });
  if (data.sendNow) await queueSend(ctx, message.id);
  else await recordEvent(ctx, { type: "outreach_generated", leadId, messageId: message.id, conversationId: conversation.id, channel: data.channel, properties: { manual: true, status: "DRAFT" } });
  return message;
}

export async function inboxSummary(ctx: TenantContext) {
  assertCan(ctx, "conversations:read");
  const [needsResponse, unread, pendingApproval, callsWaiting] = await Promise.all([
    ctx.db.conversation.count({ where: { status: "NEEDS_RESPONSE", lead: { deletedAt: null } } }),
    ctx.db.conversation.aggregate({ _sum: { unreadCount: true }, where: { lead: { deletedAt: null } } }),
    ctx.db.message.count({ where: { direction: "OUTBOUND", status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
    ctx.db.call.count({ where: { status: { in: ["PREPARED", "RINGING", "IN_PROGRESS"] } } }),
  ]);
  return { needsResponse, unread: unread._sum.unreadCount ?? 0, pendingApproval, callsWaiting };
}
