import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import type { TenantContext } from "./context";
import { logger } from "./logger";

export type NotificationType =
  | "reply.positive"
  | "lead.qualified"
  | "meeting.booked"
  | "campaign.completed"
  | "campaign.paused"
  | "workflow.failed"
  | "credits.low"
  | "payment.failed"
  | "discovery.completed"
  | "import.completed"
  | "quote.viewed"
  | "quote.accepted"
  | "quote.declined"
  | "system";

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Omit to notify every member of the workspace. */
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function notify(ctx: TenantContext, input: NotifyInput): Promise<void> {
  try {
    const notification = await ctx.db.notification.create({
      data: {
        organizationId: ctx.organizationId,
        userId: input.userId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    // External channels (Slack, email digests) are delivered asynchronously.
    await getQueue().enqueue("notifications.deliver", { notificationId: notification.id });
  } catch (error) {
    logger.error({ err: error, type: input.type }, "failed to create notification");
  }
}

/** Notifications visible to a user: addressed to them or to the whole workspace. */
export async function listNotifications(ctx: TenantContext, limit = 30) {
  const where = { OR: [{ userId: ctx.userId }, { userId: null }] };
  const [items, unread] = await Promise.all([
    ctx.db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    ctx.db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(ctx: TenantContext, ids?: string[]) {
  await ctx.db.notification.updateMany({
    where: { OR: [{ userId: ctx.userId }, { userId: null }], readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
