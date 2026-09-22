import { z } from "zod";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { recordEvent } from "../events";

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  type: z.enum(["TODO", "CALL", "EMAIL", "FOLLOW_UP", "MEETING"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueAt: z.coerce.date().nullable().optional(),
  leadId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export const taskUpdateSchema = taskInputSchema.partial().extend({ status: z.enum(["OPEN", "DONE", "CANCELED"]).optional() });

export const taskListQuerySchema = z.object({
  status: z.enum(["OPEN", "DONE", "CANCELED"]).default("OPEN"),
  assignee: z.enum(["me", "all"]).default("all"),
  leadId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  due: z.enum(["overdue", "today", "week", "any"]).default("any"),
});

export async function createTask(ctx: TenantContext, input: TaskInput, options: { workflowExecutionId?: string } = {}) {
  assertCan(ctx, "crm:write");
  const data = taskInputSchema.parse(input);
  if (data.leadId && !(await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError("Lead", data.leadId);
  if (data.dealId && !(await ctx.db.deal.findFirst({ where: { id: data.dealId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError("Deal", data.dealId);
  if (data.assigneeId && !(await ctx.db.membership.findFirst({ where: { userId: data.assigneeId } }))) throw new ValidationError("Assignee must be a workspace member");
  const task = await ctx.db.task.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description ?? null,
      type: data.type,
      priority: data.priority,
      dueAt: data.dueAt ?? null,
      leadId: data.leadId ?? null,
      dealId: data.dealId ?? null,
      assigneeId: data.assigneeId ?? ctx.userId,
      createdById: ctx.userId,
      workflowExecutionId: options.workflowExecutionId ?? null,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await recordEvent(ctx, { type: "task_created", leadId: task.leadId, dealId: task.dealId, properties: { taskId: task.id, title: task.title, type: task.type } });
  return task;
}

export async function updateTask(ctx: TenantContext, id: string, input: z.input<typeof taskUpdateSchema>) {
  assertCan(ctx, "crm:write");
  const data = taskUpdateSchema.parse(input);
  const task = await ctx.db.task.findFirst({ where: { id } });
  if (!task) throw new NotFoundError("Task", id);
  const completing = data.status === "DONE" && task.status !== "DONE";
  const updated = await ctx.db.task.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      dueAt: data.dueAt,
      assigneeId: data.assigneeId,
      status: data.status,
      completedAt: completing ? new Date() : data.status === "OPEN" ? null : undefined,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (completing) await recordEvent(ctx, { type: "task_completed", leadId: task.leadId, dealId: task.dealId, properties: { taskId: id, title: task.title } });
  return updated;
}

export async function listTasks(ctx: TenantContext, input: z.input<typeof taskListQuerySchema>) {
  assertCan(ctx, "crm:read");
  const query = taskListQuerySchema.parse(input);
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const dueFilter =
    query.due === "overdue"
      ? { dueAt: { lt: now } }
      : query.due === "today"
        ? { dueAt: { lte: endOfDay } }
        : query.due === "week"
          ? { dueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } }
          : {};
  return ctx.db.task.findMany({
    where: {
      status: query.status,
      ...(query.assignee === "me" ? { assigneeId: ctx.userId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...dueFilter,
    },
    orderBy: query.status === "OPEN" ? [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }] : [{ completedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 200,
    include: { assignee: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } }, deal: { select: { id: true, title: true, stage: true } } },
  });
}

export async function deleteTask(ctx: TenantContext, id: string) {
  assertCan(ctx, "crm:write");
  const task = await ctx.db.task.findFirst({ where: { id } });
  if (!task) throw new NotFoundError("Task", id);
  await ctx.db.task.delete({ where: { id } });
}

/** Open tasks due today or earlier for the current user (sidebar badge). */
export async function dueTaskCount(ctx: TenantContext) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return ctx.db.task.count({ where: { status: "OPEN", assigneeId: ctx.userId, dueAt: { lte: endOfDay } } });
}
