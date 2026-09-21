import type { TenantContext } from "../context";
import { executeWorkflow, triggerForEvent } from "../workflows/engine";
import { createWorkflow, setWorkflowStatus } from "../workflows/service";

/**
 * Demo automations: three live workflows whose run history is produced by the real engine
 * replaying the seeded events, plus two drafts to explore in the builder.
 */
export async function seedDemoWorkflows(ctx: TenantContext) {
  const live = ["positive-reply-follow-up", "callback-requested", "opt-out-alert"];
  const drafts = ["not-now-nurture", "meeting-to-n8n"];
  for (const template of live) {
    const workflow = await createWorkflow(ctx, { template });
    await setWorkflowStatus(ctx, workflow.id, "ACTIVE");
  }
  for (const template of drafts) await createWorkflow(ctx, { template });

  const events = await ctx.db.event.findMany({ where: { type: { in: ["reply_classified", "call_completed", "opt_out"] } }, orderBy: { occurredAt: "asc" } });
  let runs = 0;
  for (const event of events) {
    const iteration = new Date();
    if (!(await triggerForEvent(ctx, event))) continue;
    const executions = await ctx.db.workflowExecution.findMany({ where: { status: "PENDING", triggerPayload: { path: ["eventId"], equals: event.id } } });
    for (const execution of executions) await executeWorkflow(ctx, execution.id);
    // Everything the runs did belongs to a few seconds after the original event.
    const at = new Date(event.occurredAt.getTime() + 4_000);
    const done = new Date(at.getTime() + 1_200);
    const ids = executions.map((execution) => execution.id);
    await ctx.db.workflowExecution.updateMany({ where: { id: { in: ids } }, data: { createdAt: at, startedAt: at, completedAt: done } });
    await ctx.db.workflowStepRun.updateMany({ where: { executionId: { in: ids } }, data: { startedAt: at, completedAt: done } });
    await ctx.db.event.updateMany({ where: { occurredAt: { gte: iteration } }, data: { occurredAt: done } });
    await ctx.db.task.updateMany({ where: { createdAt: { gte: iteration } }, data: { createdAt: done } });
    await ctx.db.notification.updateMany({ where: { createdAt: { gte: iteration } }, data: { createdAt: done, readAt: done } });
    runs += executions.length;
  }
  const workflows = await ctx.db.workflow.findMany({ select: { id: true } });
  for (const workflow of workflows) {
    const last = await ctx.db.workflowExecution.findFirst({ where: { workflowId: workflow.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    await ctx.db.workflow.update({ where: { id: workflow.id }, data: { lastRunAt: last?.createdAt ?? null } });
  }
  return { live: live.length, drafts: drafts.length, runs };
}
