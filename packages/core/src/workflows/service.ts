import { getEnv } from "@repo/config/env";
import type { Prisma, Workflow } from "@repo/db";
import { getQueue } from "@repo/queue";
import { z } from "zod";
import { audit } from "../audit";
import { assertFeature, assertResourceLimit, resolvePlan } from "../billing/plans";
import { assertCan, systemContext, type TenantContext } from "../context";
import { signToken, verifyToken, type SignedTokenPayload } from "../crypto";
import { NotFoundError, PreconditionError, ValidationError } from "../errors";
import { executeWorkflow, sampleEventFor, startExecution, workflowSigningSecret } from "./engine";
import { validateDefinition, workflowInputSchema, type WorkflowDefinition, type WorkflowInput, type WorkflowIssue } from "./schemas";
import { getTemplate } from "./templates";

// ----------------------------------------------------------------------------- Helpers

function definitionOf(workflow: Workflow): WorkflowDefinition {
  return workflowInputSchema.parse({ name: workflow.name, description: workflow.description, trigger: workflow.trigger, steps: workflow.steps });
}

async function issuesFor(ctx: TenantContext, definition: WorkflowDefinition): Promise<WorkflowIssue[]> {
  const [plan, campaigns] = await Promise.all([resolvePlan(ctx), ctx.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true } })]);
  return validateDefinition(definition, { n8nAllowed: plan.features.n8n, campaignIds: campaigns.map((campaign) => campaign.id) });
}

interface HookToken extends SignedTokenPayload {
  o: string;
  w: string;
}

/** Inbound webhook URL for workflows triggered by n8n or other systems. The signed token is the credential. */
export function workflowHookUrl(organizationId: string, workflowId: string): string {
  return `${getEnv().APP_URL}/api/hooks/workflows/${signToken({ p: "workflow_hook", o: organizationId, w: workflowId })}`;
}

export function readWorkflowHookToken(token: string): HookToken | null {
  return verifyToken<HookToken>(token, "workflow_hook");
}

// ----------------------------------------------------------------------------- CRUD

export async function listWorkflows(ctx: TenantContext) {
  assertCan(ctx, "workflows:read");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [workflows, stats] = await Promise.all([
    ctx.db.workflow.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    ctx.db.workflowExecution.groupBy({ by: ["workflowId", "status"], where: { createdAt: { gte: since }, triggerType: { not: "test" } }, _count: { _all: true } }),
  ]);
  return workflows.map((workflow) => {
    const rows = stats.filter((row) => row.workflowId === workflow.id);
    const count = (status: string) => rows.filter((row) => row.status === status).reduce((sum, row) => sum + row._count._all, 0);
    const total = rows.reduce((sum, row) => sum + row._count._all, 0);
    const finished = count("COMPLETED") + count("FAILED");
    return { ...workflow, runs30d: total, failed30d: count("FAILED"), waiting: count("WAITING"), successRate: finished ? count("COMPLETED") / finished : null };
  });
}

export async function getWorkflow(ctx: TenantContext, id: string) {
  assertCan(ctx, "workflows:read");
  const workflow = await ctx.db.workflow.findFirst({ where: { id, deletedAt: null } });
  if (!workflow) throw new NotFoundError("Workflow", id);
  const definition = definitionOf(workflow);
  return {
    ...workflow,
    issues: await issuesFor(ctx, definition),
    hookUrl: definition.trigger.type === "webhook" ? workflowHookUrl(ctx.organizationId, workflow.id) : null,
    signingSecret: definition.steps.some((step) => step.type === "webhook") ? workflowSigningSecret(workflow.id) : null,
  };
}

export async function createWorkflow(ctx: TenantContext, input: WorkflowInput | { template: string }) {
  assertCan(ctx, "workflows:write");
  await assertFeature(ctx, "workflows");
  await assertResourceLimit(ctx, "workflows", await ctx.db.workflow.count({ where: { deletedAt: null } }));
  let source: WorkflowInput;
  if ("template" in input) {
    const template = getTemplate(input.template);
    if (!template) throw new NotFoundError("Workflow template", input.template);
    source = template.definition;
  } else {
    source = input;
  }
  const definition = workflowInputSchema.parse(source);
  const workflow = await ctx.db.workflow.create({
    data: {
      organizationId: ctx.organizationId,
      name: definition.name,
      description: definition.description,
      status: "DRAFT",
      trigger: definition.trigger as Prisma.InputJsonValue,
      steps: definition.steps as unknown as Prisma.InputJsonValue,
      createdById: ctx.userId,
    },
  });
  await audit(ctx, { action: "workflow.created", resourceType: "workflow", resourceId: workflow.id, metadata: { template: "template" in input ? input.template : null } });
  return workflow;
}

export async function updateWorkflow(ctx: TenantContext, id: string, input: WorkflowInput) {
  assertCan(ctx, "workflows:write");
  const workflow = await ctx.db.workflow.findFirst({ where: { id, deletedAt: null } });
  if (!workflow) throw new NotFoundError("Workflow", id);
  const definition = workflowInputSchema.parse(input);
  const logicChanged = JSON.stringify(definition.trigger) !== JSON.stringify(workflow.trigger) || JSON.stringify(definition.steps) !== JSON.stringify(workflow.steps);
  if (workflow.status === "ACTIVE") {
    const issues = await issuesFor(ctx, definition);
    if (issues.length) throw new ValidationError("Fix the highlighted steps before saving an active workflow", { issues });
  }
  const updated = await ctx.db.workflow.update({
    where: { id },
    data: {
      name: definition.name,
      description: definition.description,
      trigger: definition.trigger as Prisma.InputJsonValue,
      steps: definition.steps as unknown as Prisma.InputJsonValue,
      ...(logicChanged ? { version: { increment: 1 } } : {}),
    },
  });
  await audit(ctx, { action: "workflow.updated", resourceType: "workflow", resourceId: id, metadata: { version: updated.version } });
  return getWorkflow(ctx, id);
}

export async function setWorkflowStatus(ctx: TenantContext, id: string, status: "ACTIVE" | "PAUSED") {
  assertCan(ctx, "workflows:write");
  const workflow = await ctx.db.workflow.findFirst({ where: { id, deletedAt: null } });
  if (!workflow) throw new NotFoundError("Workflow", id);
  if (status === "ACTIVE") {
    await assertFeature(ctx, "workflows");
    const issues = await issuesFor(ctx, definitionOf(workflow));
    if (issues.length) throw new ValidationError(issues[0]?.message ?? "Fix the workflow before activating it", { issues });
  }
  await ctx.db.workflow.update({ where: { id }, data: { status } });
  await audit(ctx, { action: status === "ACTIVE" ? "workflow.activated" : "workflow.paused", resourceType: "workflow", resourceId: id });
  return getWorkflow(ctx, id);
}

export async function deleteWorkflow(ctx: TenantContext, id: string) {
  assertCan(ctx, "workflows:write");
  const workflow = await ctx.db.workflow.findFirst({ where: { id, deletedAt: null } });
  if (!workflow) throw new NotFoundError("Workflow", id);
  await ctx.db.workflow.update({ where: { id }, data: { deletedAt: new Date(), status: "PAUSED" } });
  await ctx.db.workflowExecution.updateMany({ where: { workflowId: id, status: { in: ["PENDING", "WAITING"] } }, data: { status: "CANCELED", completedAt: new Date(), error: "Workflow deleted" } });
  await audit(ctx, { action: "workflow.deleted", resourceType: "workflow", resourceId: id });
}

// ----------------------------------------------------------------------------- Runs

export const runSchema = z.object({ leadId: z.uuid().nullish(), dryRun: z.boolean().default(true), payload: z.record(z.string(), z.unknown()).optional() });

/**
 * Manual run or test. A test (dry run) executes synchronously and reports what each step
 * would do without changing anything.
 */
export async function runWorkflow(ctx: TenantContext, id: string, input: z.input<typeof runSchema>) {
  assertCan(ctx, "workflows:write");
  const data = runSchema.parse(input);
  const workflow = await ctx.db.workflow.findFirst({ where: { id, deletedAt: null } });
  if (!workflow) throw new NotFoundError("Workflow", id);
  const definition = definitionOf(workflow);
  if (!data.dryRun) {
    await assertFeature(ctx, "workflows");
    const issues = await issuesFor(ctx, definition);
    if (issues.length) throw new ValidationError(issues[0]?.message ?? "Fix the workflow first", { issues });
  }
  if (data.leadId && !(await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError("Lead", data.leadId);
  const execution = await startExecution(ctx, workflow, {
    triggerType: "manual",
    leadId: data.leadId ?? null,
    sampleEvent: data.dryRun ? sampleEventFor(definition.trigger) : null,
    payload: data.payload ?? { manual: true, by: ctx.userId },
    dryRun: data.dryRun,
  });
  if (!execution) throw new PreconditionError("This run was already started");
  if (data.dryRun) await executeWorkflow(ctx, execution.id);
  return getExecution(ctx, execution.id);
}

/** Re-runs a failed execution from the step that failed. */
export async function retryExecution(ctx: TenantContext, executionId: string) {
  assertCan(ctx, "workflows:write");
  const execution = await ctx.db.workflowExecution.findFirst({ where: { id: executionId } });
  if (!execution) throw new NotFoundError("Workflow execution", executionId);
  if (execution.status !== "FAILED") throw new PreconditionError("Only failed runs can be retried");
  await ctx.db.workflowExecution.update({ where: { id: executionId }, data: { status: "PENDING", error: null, completedAt: null } });
  await getQueue().enqueue("workflows.execute", { organizationId: ctx.organizationId, executionId }, { jobId: `wf:${executionId}:retry:${Date.now()}` });
}

export async function cancelExecution(ctx: TenantContext, executionId: string) {
  assertCan(ctx, "workflows:write");
  const { count } = await ctx.db.workflowExecution.updateMany({ where: { id: executionId, status: { in: ["PENDING", "WAITING", "RUNNING"] } }, data: { status: "CANCELED", completedAt: new Date(), resumeAt: null, error: "Canceled by a user" } });
  if (!count) throw new PreconditionError("This run has already finished");
}

export const executionFiltersSchema = z.object({
  workflowId: z.uuid().optional(),
  status: z.enum(["PENDING", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELED"]).optional(),
  includeTests: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listExecutions(ctx: TenantContext, filters: z.input<typeof executionFiltersSchema> = {}) {
  assertCan(ctx, "workflows:read");
  const input = executionFiltersSchema.parse(filters);
  const executions = await ctx.db.workflowExecution.findMany({
    where: { ...(input.workflowId ? { workflowId: input.workflowId } : {}), ...(input.status ? { status: input.status } : {}), ...(input.includeTests ? {} : { triggerType: { not: "test" } }) },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: { workflow: { select: { id: true, name: true } }, _count: { select: { stepRuns: true } } },
  });
  const leadIds = [...new Set(executions.map((execution) => execution.leadId).filter((leadId): leadId is string => Boolean(leadId)))];
  const leads = leadIds.length ? await ctx.db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(leads.map((lead) => [lead.id, lead.name]));
  return executions.map(({ context: _context, ...execution }) => ({ ...execution, lead: execution.leadId ? { id: execution.leadId, name: names.get(execution.leadId) ?? "Deleted lead" } : null }));
}

export async function getExecution(ctx: TenantContext, executionId: string) {
  assertCan(ctx, "workflows:read");
  const execution = await ctx.db.workflowExecution.findFirst({
    where: { id: executionId },
    include: { workflow: { select: { id: true, name: true } }, stepRuns: { orderBy: [{ stepIndex: "asc" }, { startedAt: "asc" }] } },
  });
  if (!execution) throw new NotFoundError("Workflow execution", executionId);
  const lead = execution.leadId ? await ctx.db.lead.findFirst({ where: { id: execution.leadId }, select: { id: true, name: true } }) : null;
  const context = execution.context as { definition?: unknown[]; dryRun?: boolean; stoppedReason?: string | null };
  return { ...execution, context: undefined, definition: context.definition ?? [], dryRun: Boolean(context.dryRun), stoppedReason: context.stoppedReason ?? null, lead };
}

/** Starts a webhook-triggered workflow from an inbound call (n8n or any system). */
export async function startFromHook(token: string, payload: Record<string, unknown>) {
  const hook = readWorkflowHookToken(token);
  if (!hook) return { accepted: false as const, reason: "invalid token" };
  const ctx = systemContext(hook.o, { type: "WORKFLOW", id: hook.w });
  const workflow = await ctx.db.workflow.findFirst({ where: { id: hook.w, deletedAt: null } });
  if (!workflow || workflow.status !== "ACTIVE") return { accepted: false as const, reason: "workflow is not active" };
  const definition = definitionOf(workflow);
  if (definition.trigger.type !== "webhook") return { accepted: false as const, reason: "workflow isn't webhook-triggered" };
  const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
  const lead = leadId ? await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true } }) : null;
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? `hook:${payload.idempotencyKey.slice(0, 100)}` : undefined;
  const execution = await startExecution(ctx, workflow, { triggerType: "webhook", leadId: lead?.id ?? null, payload, idempotencyKey });
  return { accepted: true as const, executionId: execution?.id ?? null, duplicate: !execution };
}
