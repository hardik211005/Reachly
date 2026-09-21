import { Prisma, type Channel, type Event, type EventType } from "@repo/db";
import { getQueue } from "@repo/queue";
import type { TenantContext } from "../context";
import { logger } from "../logger";

/**
 * The event log is the single source of truth for lead timelines and analytics.
 * Rows are append-only: nothing in the codebase updates or deletes events (except
 * organisation deletion via FK cascade).
 */

export interface RecordEventInput {
  type: EventType;
  occurredAt?: Date;
  leadId?: string | null;
  campaignId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  callId?: string | null;
  dealId?: string | null;
  workflowId?: string | null;
  workflowExecutionId?: string | null;
  channel?: Channel | null;
  value?: number | null;
  properties?: Record<string, unknown>;
  /** Makes the write idempotent per organisation (webhook retries, job retries). */
  idempotencyKey?: string;
  /** Overrides the context actor (e.g. PROVIDER for webhook-originated events). */
  actor?: { type: TenantContext["actor"]["type"]; id?: string | null };
}

/** Events that automations, outbound webhooks and notifications can react to. */
export const FANOUT_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  "lead_created",
  "lead_qualified",
  "lead_status_changed",
  "email_replied",
  "whatsapp_received",
  "reply_classified",
  "opt_out",
  "call_completed",
  "meeting_created",
  "quote_created",
  "quote_accepted",
  "deal_stage_changed",
  "deal_won",
  "deal_lost",
  "campaign_started",
  "campaign_completed",
  "workflow_failed",
  "discovery_completed",
]);

/** Events that count as "activity" on a lead (updates Lead.lastActivityAt). */
const ACTIVITY_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  "email_sent",
  "email_replied",
  "whatsapp_sent",
  "whatsapp_received",
  "call_completed",
  "meeting_created",
  "quote_sent",
  "deal_stage_changed",
  "note_added",
  "lead_status_changed",
]);

export async function recordEvent(ctx: TenantContext, input: RecordEventInput): Promise<Event | null> {
  const occurredAt = input.occurredAt ?? new Date();
  const actor = input.actor ?? ctx.actor;
  let event: Event;
  try {
    event = await ctx.db.event.create({
      data: {
        organizationId: ctx.organizationId,
        type: input.type,
        occurredAt,
        actorType: actor.type,
        actorId: actor.id ?? null,
        leadId: input.leadId ?? null,
        campaignId: input.campaignId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        callId: input.callId ?? null,
        dealId: input.dealId ?? null,
        workflowId: input.workflowId ?? null,
        workflowExecutionId: input.workflowExecutionId ?? null,
        channel: input.channel ?? null,
        value: input.value ?? null,
        properties: (input.properties ?? {}) as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Duplicate idempotency key: the event was already recorded.
      return null;
    }
    throw error;
  }

  if (input.leadId && ACTIVITY_EVENT_TYPES.has(input.type)) {
    await ctx.db.lead
      .updateMany({
        where: { id: input.leadId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }] },
        data: { lastActivityAt: occurredAt },
      })
      .catch((error: unknown) => logger.warn({ err: error, leadId: input.leadId }, "failed to bump lastActivityAt"));
  }

  if (FANOUT_EVENT_TYPES.has(input.type)) {
    await getQueue()
      .enqueue("events.fanout", { organizationId: ctx.organizationId, eventId: event.id }, { jobId: `fanout:${event.id}` })
      .catch((error: unknown) => logger.error({ err: error, eventId: event.id }, "failed to enqueue event fanout"));
  }

  return event;
}
