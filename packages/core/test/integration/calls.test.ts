import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { upsertBusinessProfile } from "../../src/business/service";
import { addLeadsToCampaign } from "../../src/campaigns/audience";
import { launchCampaign } from "../../src/campaigns/lifecycle";
import { createCampaign } from "../../src/campaigns/service";
import { CallBlockedError, callReadiness } from "../../src/calls/policy";
import { analyzeCall, appendTranscript, applyCallStatus, executeCallStart, listCalls, logManualCall, prepareCall, startCall } from "../../src/calls/service";
import { ingestVoiceWebhook } from "../../src/calls/webhooks";
import { updateCallingSettings } from "../../src/compliance/settings";
import type { TenantContext } from "../../src/context";
import { encryptJson } from "../../src/crypto";
import { FeatureNotInPlanError, PreconditionError } from "../../src/errors";
import { deleteLeads } from "../../src/leads/service";
import { inboxSummary } from "../../src/outreach/inbox";
import { prepareCampaignStep } from "../../src/outreach/sequence";
import { processWebhookEvent } from "../../src/outreach/webhooks";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

async function setup(options: { enableCalling?: boolean } = { enableCalling: true }) {
  const workspace = await createWorkspace("Calls Co");
  await setPlan(workspace.organizationId, "pro");
  await upsertBusinessProfile(workspace.ctx, { name: "Calls Co", industry: "Agency", description: "Social media for cafés.", businessSize: "SMALL" });
  if (options.enableCalling) {
    await updateCallingSettings(workspace.ctx, { callingEnabled: true, attestConsent: true, recordCalls: false, announceAiOnCalls: true, dndCheckEnabled: true });
  }
  return workspace;
}

async function phoneLead(ctx: TenantContext, name = "Monsoon Cafe") {
  return createLead(ctx, { name, phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, status: "QUALIFIED", score: 80 });
}

/** Runs a connected call through to analysis, as webhooks or the simulator would. */
async function completeCall(ctx: TenantContext, callId: string, prospectLines: string[]) {
  await applyCallStatus(ctx, callId, { status: "ringing" });
  await applyCallStatus(ctx, callId, { status: "in_progress" });
  let clock = 0;
  for (const line of prospectLines) {
    await appendTranscript(ctx, callId, [{ speaker: "agent", text: "Agent line", startMs: clock, endMs: clock + 3000 }, { speaker: "prospect", text: line, startMs: clock + 3500, endMs: clock + 6000 }], "mock");
    clock += 7000;
  }
  await applyCallStatus(ctx, callId, { status: "completed", durationSeconds: 95 });
  return analyzeCall(ctx, callId);
}

describe("AI calling", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks AI calls until calling is enabled with a consent attestation", async () => {
    const { ctx } = await setup({ enableCalling: false });
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    expect(call.status).toBe("PREPARED");
    expect(call.brief).toMatchObject({ opening: expect.stringContaining("AI assistant") });

    await expect(startCall(ctx, call.id, { confirm: true })).rejects.toMatchObject({ reason: "CALLING_DISABLED" });
    const readiness = await callReadiness(ctx);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.key === "consent")?.ok).toBe(false);

    await expect(updateCallingSettings(ctx, { callingEnabled: true, attestConsent: false, recordCalls: false, announceAiOnCalls: true, dndCheckEnabled: true })).rejects.toBeInstanceOf(PreconditionError);
    await updateCallingSettings(ctx, { callingEnabled: true, attestConsent: true, recordCalls: false, announceAiOnCalls: true, dndCheckEnabled: true });
    expect((await callReadiness(ctx)).ready).toBe(true);
    expect(await ctx.db.auditLog.count({ where: { action: "compliance.calling_updated" } })).toBe(1);
  });

  it("places, meters and analyses a call, booking the meeting the prospect agreed to", async () => {
    const { ctx } = await setup();
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    await startCall(ctx, call.id, { confirm: true });
    await executeCallStart(ctx, call.id);

    const started = await ctx.db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(started.provider).toBe("mock");
    expect(started.providerCallId).toMatch(/^mock_call_/);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CONTACTED");

    const result = await completeCall(ctx, call.id, ["Sure, go ahead.", "That could help, actually.", "Thursday afternoon works for me."]);
    expect(result).toMatchObject({ outcome: "MEETING_REQUESTED" });

    const done = await ctx.db.call.findUniqueOrThrow({ where: { id: call.id }, include: { transcript: true } });
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "MEETING_REQUESTED", durationSeconds: 95, sentiment: "POSITIVE" });
    expect(done.transcript?.fullText).toContain("Thursday afternoon");
    const meeting = await ctx.db.meeting.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(meeting.source).toBe("call");
    expect(meeting.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("MEETING");
    expect(await ctx.db.usageRecord.findFirst({ where: { metric: "VOICE_MINUTES" } })).toMatchObject({ quantity: 2 });
    for (const type of ["call_prepared", "call_started", "call_answered", "call_completed", "meeting_created"] as const) {
      expect(await ctx.db.event.count({ where: { type, leadId: lead.id } }), type).toBe(1);
    }
    // Replayed completion webhooks don't double-count.
    await applyCallStatus(ctx, call.id, { status: "completed", durationSeconds: 95 });
    expect(await ctx.db.usageRecord.count({ where: { metric: "VOICE_MINUTES" } })).toBe(1);
  });

  it("an opt-out on a call suppresses the number and the lead", async () => {
    const { ctx } = await setup();
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    await startCall(ctx, call.id, { confirm: true });
    await executeCallStart(ctx, call.id);
    const result = await completeCall(ctx, call.id, ["Please don't call this number again."]);
    expect(result).toMatchObject({ outcome: "DO_NOT_CONTACT" });
    expect(await ctx.db.suppression.count({ where: { reason: "OPT_OUT" } })).toBeGreaterThan(0);
    await expect(prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" })).rejects.toBeInstanceOf(PreconditionError);
  });

  it("unanswered calls fail without metering minutes", async () => {
    const { ctx } = await setup();
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    await startCall(ctx, call.id, { confirm: true });
    await executeCallStart(ctx, call.id);
    await applyCallStatus(ctx, call.id, { status: "ringing" });
    await applyCallStatus(ctx, call.id, { status: "no_answer" });
    expect((await ctx.db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("NO_ANSWER");
    expect(await ctx.db.usageRecord.count({ where: { metric: "VOICE_MINUTES" } })).toBe(0);
    expect(await ctx.db.event.count({ where: { type: "call_failed" } })).toBe(1);
  });

  it("manual calls are logged by a person and create follow-ups", async () => {
    const { ctx } = await setup({ enableCalling: false });
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "MANUAL" });
    await startCall(ctx, call.id, { confirm: true });
    await logManualCall(ctx, call.id, { outcome: "CALL_BACK_LATER", notes: "Busy with lunch service, call next week.", durationMinutes: 2 });
    const done = await ctx.db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "CALL_BACK_LATER", summary: "Busy with lunch service, call next week." });
    expect(await ctx.db.task.count({ where: { leadId: lead.id, type: "CALL" } })).toBe(1);
    await expect(logManualCall(ctx, call.id, { outcome: "INTERESTED" })).rejects.toBeInstanceOf(PreconditionError);
  });

  it("the AI voice agent needs the plan feature", async () => {
    const { ctx, organizationId } = await setup();
    await setPlan(organizationId, "free");
    const lead = await phoneLead(ctx);
    await expect(prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" })).rejects.toBeInstanceOf(FeatureNotInPlanError);
  });

  it("campaign voice steps prepare one call per lead and wait for approval", async () => {
    const { ctx } = await setup();
    const lead = await phoneLead(ctx);
    const campaign = await createCampaign(ctx, {
      name: "Calls",
      automationMode: "ASSISTED",
      target: {},
      channels: ["VOICE"],
      steps: [{ channel: "VOICE", delayDays: 0, condition: "ALWAYS", name: "Intro call", subject: null, body: "Introduce and book a meeting", useAI: true }],
    });
    await addLeadsToCampaign(ctx, campaign.id, [lead.id]);
    await launchCampaign(ctx, campaign.id, { confirm: true });
    const member = await ctx.db.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    await prepareCampaignStep(ctx, member.id);
    await ctx.db.campaignLead.update({ where: { id: member.id }, data: { status: "IN_SEQUENCE" } });
    await prepareCampaignStep(ctx, member.id);
    const calls = await ctx.db.call.findMany({ where: { campaignId: campaign.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: "PREPARED", type: "AI_AGENT" });

    // Starting the prepared call is the approval; a positive outcome stops the sequence.
    await startCall(ctx, calls[0]!.id, { confirm: true });
    await executeCallStart(ctx, calls[0]!.id);
    await completeCall(ctx, calls[0]!.id, ["Sounds interesting, tell me more."]);
    expect((await ctx.db.campaignLead.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("REPLIED");
  });

  it("voice webhooks are verified per workspace and applied once", async () => {
    const { ctx } = await setup();
    await ctx.db.complianceSettings.update({ where: { organizationId: ctx.organizationId }, data: { dndCheckEnabled: false } });
    await prisma.integration.create({
      data: { organizationId: ctx.organizationId, category: "VOICE", provider: "vapi", status: "CONNECTED", config: { phoneNumberId: "pn_1" }, encryptedCredentials: encryptJson({ apiKey: "vapi_key", webhookSecret: "hook-secret" }) },
    });
    const lead = await phoneLead(ctx);
    const call = await prepareCall(ctx, { leadId: lead.id, type: "AI_AGENT" });
    await ctx.db.call.update({ where: { id: call.id }, data: { status: "IN_PROGRESS", provider: "vapi", providerCallId: "vapi_1", startedAt: new Date(), answeredAt: new Date() } });

    const body = JSON.stringify({
      message: {
        type: "end-of-call-report",
        endedReason: "assistant-ended-call",
        durationSeconds: 80,
        call: { id: "vapi_1", metadata: { callId: call.id } },
        artifact: { messages: [{ role: "bot", message: "Hi there", secondsFromStart: 0 }, { role: "user", message: "Can you send me some details by email?", secondsFromStart: 4 }] },
      },
    });
    const req = (secret: string) => ({ headers: new Headers({ "x-vapi-secret": secret }), rawBody: body, url: "http://localhost:3000/api/webhooks/voice/vapi" });
    await expect(ingestVoiceWebhook("vapi", req("wrong"))).rejects.toMatchObject({ status: 401 });
    expect(await ingestVoiceWebhook("vapi", req("hook-secret"))).toMatchObject({ accepted: 2 });
    expect(await ingestVoiceWebhook("vapi", req("hook-secret"))).toMatchObject({ duplicates: 2 });

    const stored = await prisma.webhookEvent.findMany({ where: { provider: "voice_vapi" }, orderBy: { receivedAt: "asc" } });
    for (const event of stored) await processWebhookEvent(event.id);
    await analyzeCall(ctx, call.id);
    const done = await ctx.db.call.findUniqueOrThrow({ where: { id: call.id }, include: { transcript: true } });
    expect(done).toMatchObject({ status: "COMPLETED", durationSeconds: 80, outcome: "NEEDS_INFORMATION" });
    expect(done.transcript?.segments).toHaveLength(2);
  });

  it("real providers refuse demo leads and unverified DND numbers", async () => {
    const { ctx } = await setup();
    await prisma.integration.create({
      data: { organizationId: ctx.organizationId, category: "VOICE", provider: "vapi", status: "CONNECTED", config: { phoneNumberId: "pn_1" }, encryptedCredentials: encryptJson({ apiKey: "vapi_key", webhookSecret: "x" }) },
    });
    const demoLead = await phoneLead(ctx, "Demo Cafe");
    await ctx.db.lead.update({ where: { id: demoLead.id }, data: { sourceProvider: "mock" } });
    const demoCall = await prepareCall(ctx, { leadId: demoLead.id, type: "AI_AGENT" });
    await expect(startCall(ctx, demoCall.id, { confirm: true })).rejects.toMatchObject({ reason: "SIMULATED_LEAD_REAL_PROVIDER" });

    const realLead = await phoneLead(ctx, "Real Cafe");
    const realCall = await prepareCall(ctx, { leadId: realLead.id, type: "AI_AGENT" });
    await expect(startCall(ctx, realCall.id, { confirm: true })).rejects.toBeInstanceOf(CallBlockedError);
    await expect(startCall(ctx, realCall.id, { confirm: true })).rejects.toMatchObject({ reason: "DND_UNVERIFIED" });
  });

  it("calls on deleted leads leave the call lists and the waiting count", async () => {
    const { ctx } = await setup();
    const kept = await prepareCall(ctx, { leadId: (await phoneLead(ctx, "Kept Cafe")).id, type: "AI_AGENT" });
    const gone = await phoneLead(ctx, "Closed Cafe");
    await prepareCall(ctx, { leadId: gone.id, type: "AI_AGENT" });
    expect((await listCalls(ctx, { view: "queue" })).total).toBe(2);

    await deleteLeads(ctx, [gone.id]);
    const queue = await listCalls(ctx, { view: "queue" });
    expect(queue.items.map((call) => call.id)).toEqual([kept.id]);
    expect(queue.counts.queue).toBe(1);
    expect((await inboxSummary(ctx)).callsWaiting).toBe(1);
  });
});
