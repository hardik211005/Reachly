import { DEAL_STAGE_LABELS, EVENT_LABELS } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { prisma, type Event, type Prisma, type Workflow, type WorkflowExecution } from "@repo/db";
import { HttpN8nClient, IntegrationError, MockN8nClient, providerFetch, signHmacSha256, type N8nClient } from "@repo/integrations";
import { getQueue } from "@repo/queue";
import { resolvePlan } from "../billing/plans";
import { addLeadsToCampaign } from "../campaigns/audience";
import { prepareCall } from "../calls/service";
import { systemContext, type TenantContext } from "../context";
import { ensureDealAtStage } from "../crm/deals";
import { createTask } from "../crm/tasks";
import { hmacSha256, signToken, verifyToken, type SignedTokenPayload } from "../crypto";
import { AppError, NotFoundError, PreconditionError, ProviderNotConfiguredError } from "../errors";
import { recordEvent } from "../events";
import { getConnectedIntegration } from "../integrations/credentials";
import { changeLeadStatus } from "../leads/service";
import { logger } from "../logger";
import { notify } from "../notifications";
import { sendDirectMessage } from "../outreach/inbox";
import { localParts } from "../outreach/policy";
import { EVENT_TRIGGER_META, STEP_CATALOG, stepSchema, triggerSchema, WORKFLOW_EVENT_TRIGGERS, type WorkflowCondition, type WorkflowStep, type WorkflowTrigger } from "./schemas";

/**
 * Workflow engine. Executions persist their position after every step, so a crash or
 * deploy resumes where it stopped; waits (delays, n8n callbacks) park the execution and
 * the minute tick resumes it. Steps act through the normal domain services, so every
 * rule (compliance, plan limits, approvals) still applies.
 */

// ----------------------------------------------------------------------------- Execution data

interface LeadVars {
  id: string;
  name: string;
  status: string;
  score: number | null;
  fitTier: string | null;
  city: string | null;
  locality: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  ownerId: string | null;
  contactName: string | null;
  doNotContact: boolean;
  url: string;
}

export interface ExecutionData {
  dryRun?: boolean;
  workflow: { id: string; name: string };
  /** Snapshot of the steps at start, so edits don't change runs in flight. */
  definition: WorkflowStep[];
  lead: LeadVars | null;
  event: { id: string; type: string; label: string; channel: string | null; properties: Record<string, unknown>; occurredAt: string } | null;
  trigger: unknown;
  steps: Record<string, unknown>;
  waiting?: { kind: "delay" | "n8n"; stepIndex: number; stepRunId?: string; until: string } | null;
  stoppedReason?: string | null;
}

async function leadVars(ctx: TenantContext, leadId: string | null | undefined): Promise<LeadVars | null> {
  if (!leadId) return null;
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null, kind: "PERSON" }, take: 1 } } });
  if (!lead) return null;
  return {
    id: lead.id,
    name: lead.name,
    status: lead.status,
    score: lead.score,
    fitTier: lead.fitTier,
    city: lead.city,
    locality: lead.locality,
    category: lead.category,
    email: lead.email,
    phone: lead.phone,
    tags: lead.tags,
    ownerId: lead.ownerId,
    contactName: lead.contacts[0]?.name ?? null,
    doNotContact: lead.doNotContact,
    url: `${getEnv().APP_URL}/app/leads/${lead.id}`,
  };
}

export function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), source);
}

/** Replaces {{path}} with values from the execution data; unknown paths become empty. */
export function interpolate(text: string, data: unknown): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = getPath(data, path);
    if (value === null || value === undefined) return "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  });
}

export function evaluateCondition(condition: WorkflowCondition, data: unknown): boolean {
  const actual = getPath(data, condition.field);
  const expected = condition.value;
  const norm = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value);
  switch (condition.op) {
    case "exists":
      return actual !== null && actual !== undefined && actual !== "" && !(Array.isArray(actual) && actual.length === 0);
    case "not_exists":
      return !evaluateCondition({ ...condition, op: "exists" }, data);
    case "equals":
      return norm(actual) === norm(expected) || (typeof actual === "number" && Number(expected) === actual);
    case "not_equals":
      return !evaluateCondition({ ...condition, op: "equals" }, data);
    case "in":
      return Array.isArray(expected) && expected.some((value) => norm(value) === norm(actual));
    case "not_in":
      return !evaluateCondition({ ...condition, op: "in" }, data);
    case "contains":
      if (Array.isArray(actual)) return actual.some((value) => norm(value) === norm(expected));
      return typeof actual === "string" && typeof expected === "string" && actual.toLowerCase().includes(expected.toLowerCase());
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (actual === null || actual === undefined || Number.isNaN(a) || Number.isNaN(b)) return false;
      return condition.op === "gt" ? a > b : condition.op === "gte" ? a >= b : condition.op === "lt" ? a < b : a <= b;
    }
  }
}

export function evaluateConditions(conditions: WorkflowCondition[], match: "all" | "any", data: unknown): boolean {
  if (!conditions.length) return true;
  return match === "all" ? conditions.every((condition) => evaluateCondition(condition, data)) : conditions.some((condition) => evaluateCondition(condition, data));
}

// ----------------------------------------------------------------------------- n8n & outbound HTTP

export async function resolveN8n(ctx: TenantContext): Promise<N8nClient> {
  const env = getEnv();
  const integration = await getConnectedIntegration(ctx, "AUTOMATION", "n8n");
  if (integration?.config.baseUrl) {
    return new HttpN8nClient({ baseUrl: String(integration.config.baseUrl), apiKey: integration.credentials.apiKey, webhookSecret: integration.credentials.webhookSecret });
  }
  if (env.N8N_URL) return new HttpN8nClient({ baseUrl: env.N8N_URL, apiKey: env.N8N_API_KEY, webhookSecret: env.N8N_WEBHOOK_SECRET });
  if (env.DEMO_MODE) return new MockN8nClient();
  throw new ProviderNotConfiguredError("n8n", "Connect n8n in Integrations (or set N8N_URL) to run n8n steps.");
}

/** Per-workflow secret for signing outbound webhook steps; shown in the builder. */
export function workflowSigningSecret(workflowId: string): string {
  return `whsec_${hmacSha256(getEnv().SIGNING_SECRET, `workflow-webhook:${workflowId}`, "base64url").slice(0, 40)}`;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$|.*\.local$|.*\.internal$)/i;

/** SSRF guard for user-configured URLs: HTTPS to public hosts only (http/localhost allowed outside production). */
export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  const production = getEnv().NODE_ENV === "production";
  if (production && url.protocol !== "https:") throw new PreconditionError("Webhook URLs must use HTTPS");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PreconditionError("Only http(s) URLs are allowed");
  if (production && PRIVATE_HOST.test(url.hostname)) throw new PreconditionError("Webhook URLs must point to a public host");
  return url;
}

/** Credential n8n sends back to continue a waiting run (valid 7 days). */
export function n8nCallbackToken(organizationId: string, executionId: string, stepIndex: number) {
  return signToken({ p: "n8n_callback", o: organizationId, e: executionId, s: stepIndex, exp: Math.floor(Date.now() / 1000) + 7 * 86_400 });
}

// ----------------------------------------------------------------------------- Steps

type StepResult = { output: Record<string, unknown> } & ({ kind: "next" } | { kind: "stop"; reason: string } | { kind: "wait"; until: Date; waitingFor: "delay" | "n8n" });

const next = (output: Record<string, unknown>): StepResult => ({ kind: "next", output });

function requireLead(data: ExecutionData, step: WorkflowStep): LeadVars {
  if (!data.lead) throw new PreconditionError(`“${STEP_CATALOG[step.type].label}” needs a lead`);
  return data.lead;
}

async function runStep(ctx: TenantContext, step: WorkflowStep, data: ExecutionData, execution: Pick<WorkflowExecution, "id">, stepIndex: number): Promise<StepResult> {
  const dry = Boolean(data.dryRun);
  switch (step.type) {
    case "condition": {
      const passed = evaluateConditions(step.conditions, step.match, data);
      return passed ? next({ passed }) : { kind: "stop", reason: "Conditions not met", output: { passed } };
    }
    case "delay": {
      const ms = step.amount * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[step.unit];
      const until = new Date(Date.now() + ms);
      if (dry) return next({ wouldWaitUntil: until.toISOString() });
      return { kind: "wait", until, waitingFor: "delay", output: { resumeAt: until.toISOString() } };
    }
    case "update_lead_status": {
      const lead = requireLead(data, step);
      if (lead.doNotContact) return next({ skipped: "Lead is do-not-contact" });
      if (dry) return next({ wouldChange: `${lead.status} → ${step.status}` });
      await changeLeadStatus(ctx, lead.id, step.status, `Workflow: ${data.workflow.name}`);
      data.lead = { ...lead, status: step.status };
      return next({ from: lead.status, to: step.status });
    }
    case "add_tag": {
      const lead = requireLead(data, step);
      const tag = interpolate(step.tag, data).trim().toLowerCase();
      if (lead.tags.includes(tag)) return next({ tag, alreadyTagged: true });
      if (dry) return next({ wouldAdd: tag });
      await ctx.db.lead.update({ where: { id: lead.id }, data: { tags: { push: tag } } });
      data.lead = { ...lead, tags: [...lead.tags, tag] };
      return next({ tag });
    }
    case "move_deal": {
      const lead = requireLead(data, step);
      if (lead.doNotContact) return next({ skipped: "Lead is do-not-contact" });
      if (dry) return next({ wouldMoveDeal: DEAL_STAGE_LABELS[step.stage] });
      const deal = await ensureDealAtStage(ctx, lead.id, step.stage, { source: "workflow", reason: `Workflow: ${data.workflow.name}` });
      return next({ dealId: deal?.id ?? null, stage: deal?.stage ?? null });
    }
    case "create_task": {
      const title = interpolate(step.title, data);
      const dueAt = new Date(Date.now() + step.dueInDays * 86_400_000);
      if (dry) return next({ wouldCreate: title, dueAt: dueAt.toISOString() });
      const task = await createTask(ctx, { title, type: step.taskType, priority: step.priority, dueAt, leadId: data.lead?.id ?? null, assigneeId: data.lead?.ownerId ?? null }, { workflowExecutionId: execution.id });
      return next({ taskId: task.id, title });
    }
    case "add_to_campaign": {
      const lead = requireLead(data, step);
      const campaign = await ctx.db.campaign.findFirst({ where: { id: step.campaignId, deletedAt: null }, select: { name: true } });
      if (!campaign) throw new NotFoundError("Campaign", step.campaignId);
      if (dry) return next({ wouldAddTo: campaign.name });
      const result = await addLeadsToCampaign(ctx, step.campaignId, [lead.id]);
      return next({ campaign: campaign.name, added: result.added, skipped: result.skipped.map((item) => item.reason) });
    }
    case "stop_sequences": {
      const lead = requireLead(data, step);
      const active = await ctx.db.campaignLead.findMany({ where: { leadId: lead.id, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } }, select: { id: true, campaignId: true } });
      if (dry) return next({ wouldStop: active.length });
      if (active.length) {
        await ctx.db.campaignLead.updateMany({ where: { id: { in: active.map((row) => row.id) } }, data: { status: "STOPPED", nextActionAt: null, stoppedReason: `Workflow: ${data.workflow.name}` } });
        await ctx.db.message.updateMany({ where: { leadId: lead.id, direction: "OUTBOUND", campaignStepId: { not: null }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } }, data: { status: "CANCELED", error: "Stopped by a workflow" } });
        for (const row of active) await recordEvent(ctx, { type: "sequence_stopped", leadId: lead.id, campaignId: row.campaignId, properties: { reason: `Workflow: ${data.workflow.name}` } });
      }
      return next({ stopped: active.length });
    }
    case "notify": {
      const title = interpolate(step.title, data);
      const body = interpolate(step.body, data);
      if (dry) return next({ wouldNotify: title });
      await notify(ctx, { type: "system", title, body: body || undefined, link: data.lead ? `/app/leads/${data.lead.id}` : "/app/workflows", metadata: { workflowId: data.workflow.id } });
      return next({ title });
    }
    case "send_email": {
      const lead = requireLead(data, step);
      const subject = interpolate(step.subject, data);
      const body = interpolate(step.body, data);
      if (dry) return next({ wouldSend: subject, asDraft: step.requireApproval });
      try {
        const message = await sendDirectMessage(ctx, lead.id, { channel: "EMAIL", subject, body, sendNow: !step.requireApproval });
        return next({ messageId: message.id, status: message.status });
      } catch (error) {
        // Missing email / do-not-contact: skip this step, don't fail the whole run.
        if (error instanceof PreconditionError) return next({ skipped: error.message });
        throw error;
      }
    }
    case "prepare_call": {
      const lead = requireLead(data, step);
      if (dry) return next({ wouldPrepare: step.callType });
      try {
        const call = await prepareCall(ctx, { leadId: lead.id, type: step.callType });
        return next({ callId: call.id });
      } catch (error) {
        if (error instanceof PreconditionError) return next({ skipped: error.message });
        throw error;
      }
    }
    case "webhook": {
      const url = assertPublicUrl(step.url);
      const payload = { workflow: data.workflow, execution: { id: execution.id }, event: data.event, lead: step.includeLead ? data.lead : data.lead ? { id: data.lead.id } : null, trigger: data.trigger, sentAt: new Date().toISOString() };
      if (dry) return next({ wouldPost: url.toString() });
      const body = JSON.stringify(payload);
      const response = await providerFetch("webhook", url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-reachai-signature": signHmacSha256(workflowSigningSecret(data.workflow.id), body, Math.floor(Date.now() / 1000)) },
        body,
        timeoutMs: 15_000,
      });
      return next({ status: response.status, response: (await response.text()).slice(0, 500) });
    }
    case "n8n": {
      const client = await resolveN8n(ctx);
      const path = interpolate(step.webhookPath, data);
      const callback = step.waitForCallback ? { url: `${getEnv().APP_URL}/api/hooks/n8n/callback`, token: n8nCallbackToken(ctx.organizationId, execution.id, stepIndex) } : null;
      if (dry) return next({ wouldTrigger: path, simulated: client.isMock });
      const result = await client.triggerWebhook(path, { workflow: data.workflow, execution: { id: execution.id }, event: data.event, lead: data.lead, trigger: data.trigger, callback });
      if (callback) return { kind: "wait", until: new Date(Date.now() + step.timeoutHours * 3_600_000), waitingFor: "n8n", output: { status: result.status, response: result.body, simulated: client.isMock } };
      return next({ status: result.status, response: result.body, simulated: client.isMock });
    }
  }
}

// ----------------------------------------------------------------------------- Start

function workflowCtx(organizationId: string, workflowId: string) {
  return systemContext(organizationId, { type: "WORKFLOW", id: workflowId });
}

export interface StartInput {
  triggerType: WorkflowTrigger["type"];
  leadId?: string | null;
  event?: Event | null;
  /** Test runs of event workflows: a representative event built from the trigger. */
  sampleEvent?: ExecutionData["event"];
  payload?: unknown;
  idempotencyKey?: string;
  dryRun?: boolean;
}

/** A plausible event for testing an event-triggered workflow (first allowed value of each condition). */
export function sampleEventFor(trigger: WorkflowTrigger): ExecutionData["event"] {
  if (trigger.type !== "event") return null;
  const properties: Record<string, unknown> = {};
  for (const condition of trigger.conditions) {
    const match = /^event\.properties\.(\w+)$/.exec(condition.field);
    if (!match?.[1] || ["not_in", "not_equals", "not_exists"].includes(condition.op)) continue;
    properties[match[1]] = Array.isArray(condition.value) ? condition.value[0] : condition.value;
  }
  return { id: "test", type: trigger.eventType, label: EVENT_TRIGGER_META[trigger.eventType].label, channel: null, properties, occurredAt: new Date().toISOString() };
}

export async function startExecution(ctx: TenantContext, workflow: Workflow, input: StartInput): Promise<WorkflowExecution | null> {
  const steps = stepSchema.array().parse(workflow.steps);
  const data: ExecutionData = {
    dryRun: input.dryRun,
    workflow: { id: workflow.id, name: workflow.name },
    definition: steps,
    lead: await leadVars(ctx, input.leadId ?? input.event?.leadId),
    event: input.event
      ? {
          id: input.event.id,
          type: input.event.type,
          label: EVENT_TRIGGER_META[input.event.type as keyof typeof EVENT_TRIGGER_META]?.label ?? EVENT_LABELS[input.event.type] ?? input.event.type,
          channel: input.event.channel,
          properties: (input.event.properties ?? {}) as Record<string, unknown>,
          occurredAt: input.event.occurredAt.toISOString(),
        }
      : (input.sampleEvent ?? null),
    trigger: input.payload ?? null,
    steps: {},
  };
  try {
    const execution = await ctx.db.workflowExecution.create({
      data: {
        organizationId: ctx.organizationId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: "PENDING",
        engine: workflow.engine,
        triggerType: input.dryRun ? "test" : input.triggerType,
        triggerPayload: (input.payload ?? (input.event ? { eventId: input.event.id, type: input.event.type } : {})) as Prisma.InputJsonValue,
        leadId: data.lead?.id ?? null,
        context: data as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    if (!input.dryRun) {
      await ctx.db.workflow.update({ where: { id: workflow.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
      await getQueue().enqueue("workflows.execute", { organizationId: ctx.organizationId, executionId: execution.id }, { jobId: `wf:${execution.id}:start` });
    }
    return execution;
  } catch (error) {
    // Same event/schedule slot already started this workflow.
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
}

// ----------------------------------------------------------------------------- Execute

async function finish(ctx: TenantContext, execution: WorkflowExecution, data: ExecutionData, status: "COMPLETED" | "FAILED", error?: string) {
  await ctx.db.workflowExecution.update({
    where: { id: execution.id },
    data: { status, completedAt: new Date(), error: error ?? null, resumeAt: null, context: { ...data, waiting: null } as unknown as Prisma.InputJsonValue },
  });
  if (data.dryRun) return;
  const base = { workflowId: execution.workflowId, workflowExecutionId: execution.id, leadId: execution.leadId };
  if (status === "COMPLETED") {
    await recordEvent(ctx, { ...base, type: "workflow_completed", properties: { workflow: data.workflow.name, stopped: data.stoppedReason ?? null } });
  } else {
    await recordEvent(ctx, { ...base, type: "workflow_failed", properties: { workflow: data.workflow.name, error } });
    await notify(ctx, { type: "workflow.failed", title: `Workflow “${data.workflow.name}” failed`, body: error, link: `/app/workflows/${execution.workflowId}?run=${execution.id}` });
  }
}

/** Runs (or continues) an execution until it finishes, stops or has to wait. */
export async function executeWorkflow(ctx: TenantContext, executionId: string) {
  const execution = await ctx.db.workflowExecution.findFirst({ where: { id: executionId } });
  if (!execution) throw new NotFoundError("Workflow execution", executionId);
  if (["COMPLETED", "FAILED", "CANCELED"].includes(execution.status)) return { status: execution.status };
  if (execution.status === "WAITING" && execution.resumeAt && execution.resumeAt > new Date()) return { status: "WAITING" };

  const data = execution.context as unknown as ExecutionData;
  const stepCtx = workflowCtx(ctx.organizationId, execution.workflowId);
  if (!execution.startedAt && !data.dryRun) {
    await recordEvent(stepCtx, { type: "workflow_started", workflowId: execution.workflowId, workflowExecutionId: execution.id, leadId: execution.leadId, properties: { workflow: data.workflow.name, trigger: execution.triggerType } });
  }
  await ctx.db.workflowExecution.update({ where: { id: execution.id }, data: { status: "RUNNING", startedAt: execution.startedAt ?? new Date(), resumeAt: null } });
  // A worker that died mid-step leaves its step run open; the step is re-run below.
  await ctx.db.workflowStepRun.updateMany({ where: { executionId: execution.id, status: "RUNNING" }, data: { status: "FAILED", error: "Interrupted; the step was run again", completedAt: new Date() } });

  for (let index = execution.currentStepIndex; index < data.definition.length; index += 1) {
    const step = data.definition[index] as WorkflowStep;
    const stepRun = await ctx.db.workflowStepRun.create({
      data: { executionId: execution.id, stepId: step.id, stepType: step.type, stepIndex: index, status: "RUNNING", input: step as unknown as Prisma.InputJsonValue },
    });
    let result: StepResult;
    try {
      result = await runStep(stepCtx, step, data, execution, index);
    } catch (error) {
      const message = error instanceof AppError || error instanceof IntegrationError ? error.message : error instanceof Error ? error.message : String(error);
      logger.warn({ err: error, executionId, step: step.id }, "workflow step failed");
      await ctx.db.workflowStepRun.update({ where: { id: stepRun.id }, data: { status: "FAILED", error: message.slice(0, 1000), completedAt: new Date() } });
      await ctx.db.workflowExecution.update({ where: { id: execution.id }, data: { currentStepIndex: index } });
      await finish(ctx, { ...execution, currentStepIndex: index }, data, "FAILED", `Step ${index + 1} (${STEP_CATALOG[step.type].label}): ${message}`);
      return { status: "FAILED" };
    }
    data.steps[step.id] = result.output;
    const waitingOnN8n = result.kind === "wait" && result.waitingFor === "n8n";
    await ctx.db.workflowStepRun.update({
      where: { id: stepRun.id },
      data: { status: waitingOnN8n ? "WAITING" : "COMPLETED", output: result.output as Prisma.InputJsonValue, completedAt: waitingOnN8n ? null : new Date() },
    });

    if (result.kind === "stop") {
      data.stoppedReason = result.reason;
      await finish(ctx, execution, data, "COMPLETED");
      return { status: "COMPLETED", stopped: result.reason };
    }
    if (result.kind === "wait") {
      data.waiting = { kind: result.waitingFor, stepIndex: index, stepRunId: stepRun.id, until: result.until.toISOString() };
      await ctx.db.workflowExecution.update({
        where: { id: execution.id },
        data: { status: "WAITING", resumeAt: result.until, currentStepIndex: waitingOnN8n ? index : index + 1, context: data as unknown as Prisma.InputJsonValue },
      });
      return { status: "WAITING", until: result.until };
    }
    await ctx.db.workflowExecution.update({ where: { id: execution.id }, data: { currentStepIndex: index + 1, context: data as unknown as Prisma.InputJsonValue } });
  }
  await finish(ctx, execution, data, "COMPLETED");
  return { status: "COMPLETED" };
}

// ----------------------------------------------------------------------------- Triggers

/** Event subscriber: starts every active workflow listening for this event. */
export async function triggerForEvent(ctx: TenantContext, event: Event) {
  if (!(WORKFLOW_EVENT_TRIGGERS as readonly string[]).includes(event.type)) return 0;
  const workflows = await ctx.db.workflow.findMany({ where: { status: "ACTIVE", deletedAt: null, trigger: { path: ["eventType"], equals: event.type } } });
  if (!workflows.length) return 0;
  const plan = await resolvePlan(ctx);
  if (!plan.features.workflows) return 0;
  let started = 0;
  for (const workflow of workflows) {
    // A workflow never re-triggers itself from events its own steps produced.
    if (event.actorType === "WORKFLOW" && event.actorId === workflow.id) continue;
    const trigger = triggerSchema.safeParse(workflow.trigger);
    if (!trigger.success || trigger.data.type !== "event") continue;
    const lead = await leadVars(ctx, event.leadId);
    const probe = { lead, event: { type: event.type, channel: event.channel, properties: (event.properties ?? {}) as Record<string, unknown> } };
    if (!evaluateConditions(trigger.data.conditions, "all", probe)) continue;
    const execution = await startExecution(workflowCtx(ctx.organizationId, workflow.id), workflow, { triggerType: "event", event, idempotencyKey: `event:${event.id}` });
    if (execution) started += 1;
  }
  return started;
}

/** Minute tick: resume due waits, time out n8n waits, start due scheduled workflows. */
export async function workflowTick(now = new Date()) {
  const due = await prisma.workflowExecution.findMany({ where: { status: "WAITING", resumeAt: { lte: now } }, take: 200, select: { id: true, organizationId: true, context: true } });
  for (const execution of due) {
    const ctx = systemContext(execution.organizationId);
    const data = execution.context as unknown as ExecutionData;
    if (data.waiting?.kind === "n8n") {
      const full = await ctx.db.workflowExecution.findFirstOrThrow({ where: { id: execution.id } });
      if (data.waiting.stepRunId) await ctx.db.workflowStepRun.update({ where: { id: data.waiting.stepRunId }, data: { status: "FAILED", error: "n8n didn't call back in time", completedAt: now } });
      await finish(ctx, full, data, "FAILED", "n8n didn't call back before the timeout");
      continue;
    }
    await ctx.db.workflowExecution.update({ where: { id: execution.id }, data: { status: "PENDING" } });
    await getQueue().enqueue("workflows.execute", { organizationId: execution.organizationId, executionId: execution.id }, { jobId: `wf:${execution.id}:resume:${now.getTime()}` });
  }

  const scheduled = await prisma.workflow.findMany({ where: { status: "ACTIVE", deletedAt: null, trigger: { path: ["type"], equals: "schedule" } }, include: { organization: { select: { timezone: true } } } });
  let started = 0;
  for (const workflow of scheduled) {
    const trigger = triggerSchema.safeParse(workflow.trigger);
    if (!trigger.success || trigger.data.type !== "schedule") continue;
    const local = localParts(now, workflow.organization.timezone);
    if (local.hour !== trigger.data.hour || (trigger.data.frequency === "weekly" && local.weekday !== trigger.data.weekday)) continue;
    if (workflow.lastRunAt && now.getTime() - workflow.lastRunAt.getTime() < 23 * 3_600_000) continue;
    const slot = `${now.toISOString().slice(0, 13)}`;
    const execution = await startExecution(workflowCtx(workflow.organizationId, workflow.id), workflow, { triggerType: "schedule", payload: { scheduledFor: slot }, idempotencyKey: `schedule:${slot}` });
    if (execution) started += 1;
  }
  return { resumed: due.length, scheduled: started };
}

interface CallbackToken extends SignedTokenPayload {
  o: string;
  e: string;
  s: number;
}

/** n8n reporting back for a step that waits for it. The signed token is the credential. */
export async function completeN8nCallback(input: { token: string; status?: "success" | "error"; data?: unknown; error?: string }) {
  const token = verifyToken<CallbackToken>(input.token, "n8n_callback");
  if (!token) throw new AppError("UNAUTHORIZED", "Invalid or expired callback token", 401);
  const ctx = systemContext(token.o, { type: "PROVIDER", id: "n8n" });
  const execution = await ctx.db.workflowExecution.findFirst({ where: { id: token.e } });
  if (!execution) throw new NotFoundError("Workflow execution", token.e);
  const data = execution.context as unknown as ExecutionData;
  if (execution.status !== "WAITING" || data.waiting?.kind !== "n8n" || data.waiting.stepIndex !== token.s) return { ignored: "not waiting for this step" };
  const step = data.definition[token.s] as WorkflowStep;
  const failed = input.status === "error";
  const output = { ...(data.steps[step.id] as Record<string, unknown> | undefined), callback: input.data ?? null };
  const stepRunId = data.waiting.stepRunId;
  data.steps[step.id] = output;
  data.waiting = null;
  if (stepRunId) {
    await ctx.db.workflowStepRun.update({ where: { id: stepRunId }, data: { status: failed ? "FAILED" : "COMPLETED", output: output as Prisma.InputJsonValue, error: failed ? (input.error ?? "n8n reported an error") : null, completedAt: new Date() } });
  }
  if (failed) {
    await finish(ctx, execution, data, "FAILED", `n8n: ${input.error ?? "reported an error"}`);
    return { status: "FAILED" };
  }
  await ctx.db.workflowExecution.update({ where: { id: execution.id }, data: { status: "PENDING", resumeAt: null, currentStepIndex: token.s + 1, context: data as unknown as Prisma.InputJsonValue } });
  await getQueue().enqueue("workflows.execute", { organizationId: token.o, executionId: execution.id }, { jobId: `wf:${execution.id}:n8n:${token.s}` });
  return { status: "RESUMED" };
}
