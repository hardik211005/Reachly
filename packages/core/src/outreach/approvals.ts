import type { Channel, Prisma } from "@repo/db";
import { z } from "zod";
import { getQueue } from "@repo/queue";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";
import { audit } from "../audit";
import { advanceSequence } from "./sequence";

/**
 * Human-in-the-loop review queue. MANUAL campaigns produce drafts, ASSISTED campaigns
 * produce messages pending approval, and AUTOMATED campaigns route first touches here
 * when the workspace requires approval for them.
 */

const REVIEWABLE = ["DRAFT", "PENDING_APPROVAL"] as const;

export const approvalEditSchema = z.object({
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1).max(5000).optional(),
});

export const approvalFiltersSchema = z.object({
  campaignId: z.uuid().optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listApprovals(ctx: TenantContext, filters: z.input<typeof approvalFiltersSchema> = {}) {
  assertCan(ctx, "campaigns:read");
  const input = approvalFiltersSchema.parse(filters);
  const where: Prisma.MessageWhereInput = {
    direction: "OUTBOUND",
    status: { in: [...REVIEWABLE] },
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
  };
  const [items, total, byCampaign] = await Promise.all([
    ctx.db.message.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: input.limit,
      include: {
        lead: { select: { id: true, name: true, category: true, city: true, locality: true, score: true, website: true, sourceProvider: true } },
        campaign: { select: { id: true, name: true, automationMode: true } },
        campaignStep: { select: { name: true, order: true } },
      },
    }),
    ctx.db.message.count({ where }),
    ctx.db.message.groupBy({ by: ["campaignId"], where: { direction: "OUTBOUND", status: { in: [...REVIEWABLE] } }, _count: { _all: true } }),
  ]);
  return { items, total, byCampaign: byCampaign.map((row) => ({ campaignId: row.campaignId, count: row._count._all })) };
}

async function loadReviewable(ctx: TenantContext, messageId: string) {
  const message = await ctx.db.message.findFirst({ where: { id: messageId, direction: "OUTBOUND" }, include: { campaign: true } });
  if (!message) throw new NotFoundError("Message", messageId);
  if (!REVIEWABLE.includes(message.status as (typeof REVIEWABLE)[number])) throw new PreconditionError(`This message is already ${message.status.toLowerCase().replace(/_/g, " ")}`);
  return message;
}

export async function updateDraft(ctx: TenantContext, messageId: string, edits: z.input<typeof approvalEditSchema>) {
  assertCan(ctx, "outreach:approve");
  const input = approvalEditSchema.parse(edits);
  const message = await loadReviewable(ctx, messageId);
  const edited = (input.body !== undefined && input.body !== message.body) || (input.subject !== undefined && input.subject !== message.subject);
  return ctx.db.message.update({
    where: { id: message.id },
    data: {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(edited ? { metadata: { ...((message.metadata ?? {}) as Record<string, unknown>), editedByHuman: true } as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function approveMessage(ctx: TenantContext, messageId: string, edits: z.input<typeof approvalEditSchema> = {}) {
  assertCan(ctx, "outreach:approve");
  const message = await loadReviewable(ctx, messageId);
  if (message.channel !== "EMAIL" && message.channel !== "WHATSAPP") throw new PreconditionError("Only email and WhatsApp messages go through approval");
  if (message.channel === "EMAIL" && !(edits.subject ?? message.subject)) throw new PreconditionError("Add a subject line before approving");
  if (edits.body !== undefined || edits.subject !== undefined) await updateDraft(ctx, messageId, edits);

  const now = new Date();
  await ctx.db.message.update({ where: { id: message.id }, data: { status: "APPROVED", approvedById: ctx.userId, approvedAt: now, scheduledFor: now } });
  if (message.campaignId) {
    await ctx.db.campaignLead.updateMany({ where: { campaignId: message.campaignId, leadId: message.leadId, status: "AWAITING_APPROVAL" }, data: { status: "IN_SEQUENCE" } });
  }
  await recordEvent(ctx, { type: "message_approved", leadId: message.leadId, campaignId: message.campaignId, messageId: message.id, conversationId: message.conversationId, channel: message.channel, properties: { edited: edits.body !== undefined && edits.body !== message.body } });
  // A paused campaign keeps approved messages; resume sends them.
  if (!message.campaign || message.campaign.status === "ACTIVE") {
    await getQueue().enqueue("messages.send", { organizationId: ctx.organizationId, messageId: message.id }, { jobId: `send:${message.id}:approved` });
  }
  return { status: "APPROVED" as const };
}

export async function rejectMessage(ctx: TenantContext, messageId: string, input: { reason?: string; action?: "skip_step" | "stop_lead" } = {}) {
  assertCan(ctx, "outreach:approve");
  const message = await loadReviewable(ctx, messageId);
  const reason = input.reason?.trim() || "Rejected during review";
  await ctx.db.message.update({ where: { id: message.id }, data: { status: "CANCELED", error: reason, metadata: { ...((message.metadata ?? {}) as Record<string, unknown>), rejectedById: ctx.userId } as Prisma.InputJsonValue } });
  if (message.campaignId) {
    const campaignLead = await ctx.db.campaignLead.findFirst({ where: { campaignId: message.campaignId, leadId: message.leadId } });
    if (campaignLead) {
      if (input.action === "stop_lead") {
        await ctx.db.campaignLead.update({ where: { id: campaignLead.id }, data: { status: "STOPPED", stoppedReason: reason, nextActionAt: null } });
        await recordEvent(ctx, { type: "sequence_stopped", leadId: message.leadId, campaignId: message.campaignId, properties: { reason, byUser: true } });
      } else {
        await ctx.db.campaignLead.update({ where: { id: campaignLead.id }, data: { status: "IN_SEQUENCE" } });
        await advanceSequence(ctx, campaignLead.id);
      }
    }
  }
  await audit(ctx, { action: "message.rejected", resourceType: "message", resourceId: message.id, metadata: { reason, action: input.action ?? "skip_step" } });
  return { status: "CANCELED" as const };
}

export async function bulkReview(ctx: TenantContext, input: { ids: string[]; action: "approve" | "reject" }) {
  assertCan(ctx, "outreach:approve");
  const results = { succeeded: 0, failed: [] as Array<{ id: string; error: string }> };
  for (const id of input.ids.slice(0, 200)) {
    try {
      if (input.action === "approve") await approveMessage(ctx, id);
      else await rejectMessage(ctx, id);
      results.succeeded += 1;
    } catch (error) {
      results.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export async function countPendingApprovals(ctx: TenantContext, channel?: Channel) {
  return ctx.db.message.count({ where: { direction: "OUTBOUND", status: { in: [...REVIEWABLE] }, ...(channel ? { channel } : {}) } });
}
