import type { Prisma } from "@repo/db";
import type { TenantContext } from "./context";
import { logger } from "./logger";

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Append an audit log entry. Failures are logged, never thrown, so auditing can't break flows. */
export async function audit(ctx: TenantContext, input: AuditInput): Promise<void> {
  try {
    await ctx.db.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, "failed to write audit log");
  }
}
