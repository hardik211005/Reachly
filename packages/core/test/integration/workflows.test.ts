import { beforeEach, describe, expect, it } from "vitest";
import { upsertBusinessProfile } from "../../src/business/service";
import type { TenantContext } from "../../src/context";
import { FeatureNotInPlanError, ValidationError } from "../../src/errors";
import { recordEvent } from "../../src/events";
import { completeN8nCallback, executeWorkflow, n8nCallbackToken, triggerForEvent, workflowTick } from "../../src/workflows/engine";
import type { WorkflowInput } from "../../src/workflows/schemas";
import { createWorkflow, getExecution, readWorkflowHookToken, retryExecution, runWorkflow, setWorkflowStatus, startFromHook, workflowHookUrl } from "../../src/workflows/service";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

async function setup(plan = "pro") {
  const workspace = await createWorkspace("Automation Co");
  await setPlan(workspace.organizationId, plan);
  await upsertBusinessProfile(workspace.ctx, { name: "Automation Co", industry: "Agency", description: "Growth agency for cafés and restaurants.", businessSize: "SMALL" });
  return workspace;
}

async function activeWorkflow(ctx: TenantContext, input: WorkflowInput | { template: string }) {
  const workflow = await createWorkflow(ctx, input);
  await setWorkflowStatus(ctx, workflow.id, "ACTIVE");
  return ctx.db.workflow.findFirstOrThrow({ where: { id: workflow.id } });
}

/** Records an event and runs whatever it triggered, like the fan-out job + worker would. */
async function fire(ctx: TenantContext, input: Parameters<typeof recordEvent>[1]) {
  const event = await recordEvent(ctx, input);
  if (!event) throw new Error("event not recorded");
  await triggerForEvent(ctx, event);
  const executions = await ctx.db.workflowExecution.findMany({ where: { triggerPayload: { path: ["eventId"], equals: event.id } } });
  for (const execution of executions) await executeWorkflow(ctx, execution.id);
  return { event, executions };
}

describe("workflow engine", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("runs a template end to end on a matching event, once", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, { template: "positive-reply-follow-up" });
    const lead = await createLead(ctx, { name: "Monsoon Cafe", status: "REPLIED" });

    const { event, executions } = await fire(ctx, { type: "reply_classified", leadId: lead.id, properties: { intent: "POSITIVE" } });
    expect(executions).toHaveLength(1);
    const run = await getExecution(ctx, executions[0]!.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.stepRuns.map((step) => step.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"]);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("INTERESTED");
    expect(await ctx.db.task.findFirst({ where: { leadId: lead.id } })).toMatchObject({ title: "Reply to Monsoon Cafe today", priority: "HIGH" });
    expect(await ctx.db.notification.findFirst({ where: { title: "Monsoon Cafe replied positively" } })).toBeTruthy();
    expect(await ctx.db.event.count({ where: { type: "workflow_completed", workflowId: workflow.id } })).toBe(1);

    // The same event never starts the workflow twice (fan-out retries).
    await triggerForEvent(ctx, event);
    expect(await ctx.db.workflowExecution.count({ where: { workflowId: workflow.id } })).toBe(1);
  });

  it("ignores events that don't match the trigger's conditions or that it caused itself", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, { template: "positive-reply-follow-up" });
    const lead = await createLead(ctx, { name: "Quiet Cafe" });
    await fire(ctx, { type: "reply_classified", leadId: lead.id, properties: { intent: "NOT_NOW" } });
    await fire(ctx, { type: "reply_classified", leadId: lead.id, properties: { intent: "POSITIVE" }, actor: { type: "WORKFLOW", id: workflow.id } });
    expect(await ctx.db.workflowExecution.count()).toBe(0);
  });

  it("a condition step stops the run cleanly when it doesn't match", async () => {
    const { ctx } = await setup();
    await activeWorkflow(ctx, { template: "high-fit-to-campaign" });
    const lead = await createLead(ctx, { name: "Lukewarm Cafe", score: 55, phone: "+919800000001" });
    const { executions } = await fire(ctx, { type: "lead_qualified", leadId: lead.id });
    const run = await getExecution(ctx, executions[0]!.id);
    expect(run).toMatchObject({ status: "COMPLETED", stoppedReason: "Conditions not met" });
    expect(run.stepRuns).toHaveLength(1);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).tags).toEqual([]);
  });

  it("delays park the run and the tick resumes it", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, {
      name: "Wait then notify",
      trigger: { type: "manual" },
      steps: [
        { id: "wait", type: "delay", amount: 2, unit: "days" },
        { id: "notify", type: "notify", title: "Two days later", body: "" },
      ],
    });
    const run = await runWorkflow(ctx, workflow.id, { dryRun: false });
    await executeWorkflow(ctx, run.id);
    const waiting = await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } });
    expect(waiting.status).toBe("WAITING");
    expect(waiting.resumeAt!.getTime() - Date.now()).toBeGreaterThan(1.9 * 86_400_000);

    await workflowTick(new Date(Date.now() + 3 * 86_400_000));
    expect((await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("PENDING");
    // The tick checks the clock itself; move the wait into the past as time would.
    await ctx.db.workflowExecution.update({ where: { id: run.id }, data: { resumeAt: null } });
    await executeWorkflow(ctx, run.id);
    expect((await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await ctx.db.notification.count({ where: { title: "Two days later" } })).toBe(1);
  });

  it("test runs report what each step would do without changing anything", async () => {
    const { ctx } = await setup();
    const workflow = await createWorkflow(ctx, { template: "positive-reply-follow-up" });
    const lead = await createLead(ctx, { name: "Test Cafe", status: "REPLIED" });
    const run = await runWorkflow(ctx, workflow.id, { leadId: lead.id, dryRun: true });
    expect(run).toMatchObject({ status: "COMPLETED", dryRun: true, triggerType: "test" });
    expect(run.stepRuns[0]?.output).toMatchObject({ wouldChange: "REPLIED → INTERESTED" });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("REPLIED");
    expect(await ctx.db.task.count()).toBe(0);
    expect(await ctx.db.notification.count()).toBe(0);
  });

  it("failures are visible and can be retried from the failed step", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, {
      name: "Post somewhere",
      trigger: { type: "manual" },
      steps: [
        { id: "tag", type: "notify", title: "Before", body: "" },
        { id: "post", type: "webhook", url: "http://127.0.0.1:9/hook", includeLead: false },
      ],
    });
    const run = await runWorkflow(ctx, workflow.id, { dryRun: false });
    await executeWorkflow(ctx, run.id);
    const failed = await getExecution(ctx, run.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/Step 2 \(Send webhook\)/);
    expect(await ctx.db.event.count({ where: { type: "workflow_failed" } })).toBe(1);
    expect(await ctx.db.notification.count({ where: { type: "workflow.failed" } })).toBe(1);

    await retryExecution(ctx, run.id);
    const retried = await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } });
    expect(retried).toMatchObject({ status: "PENDING", currentStepIndex: 1 });
  });

  it("n8n steps can wait for a signed callback and continue with its data", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, {
      name: "Enrich via n8n",
      trigger: { type: "manual" },
      steps: [
        { id: "enrich", type: "n8n", webhookPath: "reachai-enrich", waitForCallback: true, timeoutHours: 2 },
        { id: "notify", type: "notify", title: "Enriched: {{steps.enrich.callback.size}}", body: "" },
      ],
    });
    const run = await runWorkflow(ctx, workflow.id, { dryRun: false });
    await executeWorkflow(ctx, run.id);
    expect((await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("WAITING");

    await expect(completeN8nCallback({ token: "forged.token", data: {} })).rejects.toMatchObject({ status: 401 });
    const result = await completeN8nCallback({ token: n8nCallbackToken(ctx.organizationId, run.id, 0), status: "success", data: { size: "12 outlets" } });
    expect(result).toEqual({ status: "RESUMED" });
    await executeWorkflow(ctx, run.id);
    expect((await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await ctx.db.notification.findFirst({ where: { title: "Enriched: 12 outlets" } })).toBeTruthy();
  });

  it("n8n waits time out instead of hanging forever", async () => {
    const { ctx } = await setup();
    const workflow = await activeWorkflow(ctx, { name: "Waits", trigger: { type: "manual" }, steps: [{ id: "n", type: "n8n", webhookPath: "x", waitForCallback: true, timeoutHours: 1 }] });
    const run = await runWorkflow(ctx, workflow.id, { dryRun: false });
    await executeWorkflow(ctx, run.id);
    await workflowTick(new Date(Date.now() + 2 * 3_600_000));
    expect(await ctx.db.workflowExecution.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "FAILED", error: "n8n didn't call back before the timeout" });
  });

  it("won't activate a workflow with structural problems", async () => {
    const { ctx } = await setup();
    const workflow = await createWorkflow(ctx, { name: "Broken", trigger: { type: "schedule", frequency: "daily", hour: 9 }, steps: [{ id: "s", type: "add_tag", tag: "x" }] });
    await expect(setWorkflowStatus(ctx, workflow.id, "ACTIVE")).rejects.toBeInstanceOf(ValidationError);
  });

  it("webhook-triggered workflows start from their signed URL", async () => {
    const { ctx, organizationId } = await setup();
    const lead = await createLead(ctx, { name: "Hooked Cafe" });
    const workflow = await activeWorkflow(ctx, { name: "From n8n", trigger: { type: "webhook" }, steps: [{ id: "tag", type: "add_tag", tag: "from-n8n" }] });
    const token = workflowHookUrl(organizationId, workflow.id).split("/").at(-1)!;
    expect(readWorkflowHookToken(token)).toMatchObject({ w: workflow.id });
    expect(await startFromHook(`${token}x`, {})).toMatchObject({ accepted: false });
    const started = await startFromHook(token, { leadId: lead.id, idempotencyKey: "abc" });
    expect(started).toMatchObject({ accepted: true, duplicate: false });
    expect(await startFromHook(token, { leadId: lead.id, idempotencyKey: "abc" })).toMatchObject({ accepted: true, duplicate: true });
    await executeWorkflow(ctx, started.accepted ? started.executionId! : "");
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).tags).toEqual(["from-n8n"]);
  });

  it("moves the lead's deal forward (never back) from a workflow", async () => {
    const { ctx } = await setup();
    const lead = await createLead(ctx, { name: "Deal Cafe", status: "REPLIED" });
    const workflow = await activeWorkflow(ctx, { name: "To meeting", trigger: { type: "manual" }, steps: [{ id: "deal", type: "move_deal", stage: "MEETING" }] });
    const test = await runWorkflow(ctx, workflow.id, { leadId: lead.id, dryRun: true });
    expect(test.stepRuns[0]?.output).toMatchObject({ wouldMoveDeal: "Meeting" });
    expect(await ctx.db.deal.count()).toBe(0);

    const run = await runWorkflow(ctx, workflow.id, { leadId: lead.id, dryRun: false });
    await executeWorkflow(ctx, run.id);
    const deal = await ctx.db.deal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(deal.stage).toBe("MEETING");
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("MEETING");

    await ctx.db.deal.update({ where: { id: deal.id }, data: { stage: "NEGOTIATION" } });
    const again = await runWorkflow(ctx, workflow.id, { leadId: lead.id, dryRun: false });
    await executeWorkflow(ctx, again.id);
    expect((await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe("NEGOTIATION");
  });

  it("workflows need the plan feature", async () => {
    const { ctx } = await setup("free");
    await expect(createWorkflow(ctx, { template: "opt-out-alert" })).rejects.toBeInstanceOf(FeatureNotInPlanError);
  });
});
