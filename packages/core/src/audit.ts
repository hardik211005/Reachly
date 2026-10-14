import { prisma, type Prisma } from "@repo/db";
import { z } from "zod";
import { assertCan, type TenantContext } from "./context";
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

export const auditListQuerySchema = z.object({
  /** Action prefix, e.g. "billing" or "scoring.updated". */
  action: z.string().trim().max(80).optional(),
  actorType: z.enum(["USER", "SYSTEM", "API_KEY", "WORKFLOW", "AI", "PROVIDER"]).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Newest first, with actors resolved to names. Admins only. */
export async function listAuditLogs(ctx: TenantContext, input: z.input<typeof auditListQuerySchema> = {}) {
  assertCan(ctx, "audit:read");
  const query = auditListQuerySchema.parse(input);
  const cursor = query.cursor ? await ctx.db.auditLog.findFirst({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
  const rows = await ctx.db.auditLog.findMany({
    where: {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      // Entries can share a timestamp, so the id breaks ties and no row is skipped between pages.
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const userIds = [...new Set(page.filter((row) => row.actorType === "USER" && row.actorId).map((row) => row.actorId as string))];
  const keyIds = [...new Set(page.filter((row) => row.actorType === "API_KEY" && row.actorId).map((row) => row.actorId as string))];
  const [users, keys, actions] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    keyIds.length ? ctx.db.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, name: true } }) : [],
    ctx.db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);
  const actorName = (row: (typeof page)[number]) => {
    if (row.actorType === "USER") {
      const user = users.find((item) => item.id === row.actorId);
      return user ? user.name || user.email : "Deleted user";
    }
    if (row.actorType === "API_KEY") return `API key “${keys.find((item) => item.id === row.actorId)?.name ?? "revoked"}”`;
    return { SYSTEM: "Reachly", WORKFLOW: "Workflow", AI: "AI", PROVIDER: "Provider" }[row.actorType] ?? row.actorType;
  };
  return {
    items: page.map((row) => ({ id: row.id, action: row.action, resourceType: row.resourceType, resourceId: row.resourceId, metadata: row.metadata, actorType: row.actorType, actor: actorName(row), ipAddress: row.ipAddress, createdAt: row.createdAt })),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    actions: actions.map((item) => ({ action: item.action, count: item._count._all })),
  };
}
