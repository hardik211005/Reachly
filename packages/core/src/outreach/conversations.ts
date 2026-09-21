import type { Channel } from "@repo/db";
import type { TenantContext } from "../context";

/** One open conversation per lead + channel (+ campaign when campaign-driven). */
export async function findOrCreateConversation(
  ctx: TenantContext,
  input: { leadId: string; channel: Channel; campaignId?: string | null; contactId?: string | null; subject?: string | null },
) {
  const existing = await ctx.db.conversation.findFirst({
    where: { leadId: input.leadId, channel: input.channel, status: { not: "CLOSED" } },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) {
    if ((!existing.campaignId && input.campaignId) || (!existing.contactId && input.contactId)) {
      return ctx.db.conversation.update({
        where: { id: existing.id },
        data: { campaignId: existing.campaignId ?? input.campaignId ?? null, contactId: existing.contactId ?? input.contactId ?? null },
      });
    }
    return existing;
  }
  return ctx.db.conversation.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      channel: input.channel,
      campaignId: input.campaignId ?? null,
      contactId: input.contactId ?? null,
      subject: input.subject ?? null,
      status: "OPEN",
    },
  });
}

/** WhatsApp's customer-service window: free-form messages allowed for 24h after the last inbound. */
export function whatsappWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000);
}
