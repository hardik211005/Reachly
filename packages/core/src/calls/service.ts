import { CHANNEL_UNIT_COST_USD, type CallOutcome } from "@repo/config";
import { getEnv } from "@repo/config/env";
import type { Call, Prisma } from "@repo/db";
import { IntegrationError, transcriptText, type TranscriptSegment, type VoiceCallStatus, type VoiceTranscript } from "@repo/integrations";
import { getQueue } from "@repo/queue";
import { z } from "zod";
import { analyzeCallDeterministically, callAnalysisAgent, callBriefAgent, composeCallBrief, type CallAnalysis, type CallBrief } from "../ai/agents/calls";
import { runAgent } from "../ai/service";
import { assertFeature } from "../billing/plans";
import { consumeUsage, isLimitError } from "../billing/usage";
import { addSuppression } from "../compliance/suppression";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { notify } from "../notifications";
import { leadContext, primaryContact, sellerContext } from "../outreach/context";
import { advanceSequence, registerVoiceStepHandler } from "../outreach/sequence";
import { assertCanCall, CallBlockedError, callingWindow } from "./policy";
import { resolveVoiceProvider } from "./providers";
import { parseSuggestedTime } from "./schedule";

/**
 * Call lifecycle:
 *   prepareCall (AI brief) → startCall (policy + explicit start) → calls.start job
 *   → provider → status/transcript webhooks (or the demo simulator)
 *   → applyCallStatus → analyzeCall (outcome, summary, next step) → CRM side effects.
 */

const TERMINAL: VoiceCallStatus[] = ["completed", "no_answer", "busy", "failed", "canceled"];
const STATUS_MAP: Record<VoiceCallStatus, Call["status"]> = {
  queued: "QUEUED",
  ringing: "RINGING",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  no_answer: "NO_ANSWER",
  busy: "BUSY",
  failed: "FAILED",
  canceled: "CANCELED",
};
const MAX_CALL_SECONDS = 300;

interface CallMetadata {
  campaignLeadId?: string;
  stepName?: string;
  simulated?: boolean;
  scenario?: string;
  hangupRequested?: boolean;
  outsideHoursSimulated?: boolean;
  analysis?: Pick<CallAnalysis, "interestLevel" | "keyPoints" | "objections" | "meetingRequested" | "optOut"> & { source: "ai" | "rules" | "manual" };
  meetingId?: string;
  endedReason?: string | null;
}

function meta(call: Pick<Call, "metadata">): CallMetadata {
  return (call.metadata ?? {}) as CallMetadata;
}

async function patchMeta(ctx: TenantContext, call: Pick<Call, "id" | "metadata">, patch: Partial<CallMetadata>) {
  return ctx.db.call.update({ where: { id: call.id }, data: { metadata: { ...meta(call), ...patch } as Prisma.InputJsonValue } });
}

// ----------------------------------------------------------------------------- Prepare

export const prepareCallSchema = z.object({
  leadId: z.uuid(),
  type: z.enum(["AI_AGENT", "MANUAL"]).default("AI_AGENT"),
  campaignId: z.uuid().nullish(),
  contactId: z.uuid().nullish(),
  scheduledFor: z.coerce.date().nullish(),
});

export async function prepareCall(ctx: TenantContext, input: z.input<typeof prepareCallSchema>, options: { campaignLeadId?: string; stepName?: string } = {}) {
  assertCan(ctx, "calls:place");
  const data = prepareCallSchema.parse(input);
  if (data.type === "AI_AGENT") await assertFeature(ctx, "voiceAgent");
  const lead = await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", data.leadId);
  if (lead.doNotContact) throw new PreconditionError("This lead is marked do-not-contact");
  const contact = data.contactId ? (lead.contacts.find((item) => item.id === data.contactId) ?? null) : primaryContact(lead.contacts, "PHONE");
  const phone = contact?.phone ?? contact?.whatsapp ?? lead.phone;
  if (!phone) throw new PreconditionError("This lead has no phone number");
  const campaign = data.campaignId ? await ctx.db.campaign.findFirst({ where: { id: data.campaignId, deletedAt: null } }) : null;

  const [compliance, seller, history] = await Promise.all([
    ctx.db.complianceSettings.findFirst(),
    sellerContext(ctx, { offer: campaign?.offerSummary, pitchAngle: campaign?.pitchAngle, offeringIds: campaign?.offeringIds, includePricing: true }),
    ctx.db.message.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 6, select: { direction: true, channel: true, body: true } }),
  ]);
  const briefInput = {
    lead: leadContext(lead),
    seller,
    campaignObjective: campaign?.description ?? null,
    history: history.reverse().map((message) => ({ direction: message.direction, channel: message.channel, body: message.body.slice(0, 400) })),
    announceAi: data.type === "AI_AGENT" && (compliance?.announceAiOnCalls ?? true),
  };
  let brief: CallBrief;
  let aiRequestId: string | null = null;
  try {
    const result = await runAgent(ctx, callBriefAgent, briefInput, { leadId: lead.id, campaignId: campaign?.id ?? null });
    brief = result.output;
    aiRequestId = result.meta.aiRequestId;
  } catch (error) {
    // A brief is required to call; fall back to the grounded template rather than blocking.
    logger.warn({ err: error, leadId: lead.id }, "call brief generation failed; using template brief");
    brief = composeCallBrief(briefInput);
  }

  const call = await ctx.db.call.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      contactId: contact?.id ?? null,
      campaignId: campaign?.id ?? null,
      type: data.type,
      status: "PREPARED",
      toNumber: phone,
      brief: brief as unknown as Prisma.InputJsonValue,
      scheduledFor: data.scheduledFor ?? null,
      createdById: ctx.userId,
      metadata: { campaignLeadId: options.campaignLeadId, stepName: options.stepName, briefAiRequestId: aiRequestId } as Prisma.InputJsonValue,
    },
  });
  await recordEvent(ctx, { type: "call_prepared", leadId: lead.id, campaignId: campaign?.id ?? null, callId: call.id, channel: data.type === "AI_AGENT" ? "VOICE" : "MANUAL_CALL", properties: { type: data.type, step: options.stepName ?? null } });
  return call;
}

// ----------------------------------------------------------------------------- Start

export async function startCall(ctx: TenantContext, callId: string, input: { confirm: boolean }) {
  assertCan(ctx, "calls:place");
  if (!input.confirm) throw new ValidationError("Confirm the call to start it");
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { lead: true } });
  if (!call) throw new NotFoundError("Call", callId);
  if (call.status !== "PREPARED") throw new PreconditionError(`This call is already ${call.status.toLowerCase().replace(/_/g, " ")}`);
  const campaignLeadId = meta(call).campaignLeadId;
  if (campaignLeadId) await ctx.db.campaignLead.updateMany({ where: { id: campaignLeadId, status: "AWAITING_APPROVAL" }, data: { status: "IN_SEQUENCE", nextActionAt: null } });

  if (call.type === "MANUAL") {
    // A person dials from their own phone; we record the attempt and wait for the outcome.
    const now = new Date();
    await ctx.db.call.update({ where: { id: call.id }, data: { status: "IN_PROGRESS", startedAt: now, metadata: { ...meta(call), startedById: ctx.userId } as Prisma.InputJsonValue } });
    await recordEvent(ctx, { type: "call_started", leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel: "MANUAL_CALL", properties: { type: "MANUAL" } });
    return { status: "IN_PROGRESS" as const, scheduledFor: null };
  }

  const provider = await resolveVoiceProvider(ctx);
  await assertCanCall(ctx, call.lead, call.toNumber, { providerIsMock: provider.isMock });
  const window = await callingWindow(ctx);
  let scheduledFor: Date | null = null;
  if (!window.open) {
    if (provider.isMock) await patchMeta(ctx, call, { outsideHoursSimulated: true });
    else scheduledFor = window.next;
  }
  await ctx.db.call.update({ where: { id: call.id }, data: { status: "QUEUED", scheduledFor, provider: provider.name } });
  await getQueue().enqueue("calls.start", { organizationId: ctx.organizationId, callId: call.id }, { jobId: `call-start:${call.id}`, delayMs: scheduledFor ? Math.max(0, scheduledFor.getTime() - Date.now()) : 0 });
  return { status: "QUEUED" as const, scheduledFor };
}

function systemPrompt(brief: CallBrief, seller: { senderName: string; businessName: string }): string {
  return [
    `You are an AI assistant making a short outbound phone call on behalf of ${seller.senderName} at ${seller.businessName}.`,
    `Objective: ${brief.objective}`,
    `About the prospect: ${brief.summary}`,
    `Pitch: ${brief.pitch}`,
    `Talking points: ${brief.talkingPoints.join(" | ")}`,
    `Questions to ask: ${brief.questions.join(" | ")}`,
    `Objection handling: ${brief.objections.map((item) => `"${item.objection}" → ${item.response}`).join(" | ")}`,
    `Close with: ${brief.closing}`,
    `If you reach voicemail, say: ${brief.voicemail} — then end the call.`,
    `Rules: ${brief.guardrails.join(" ")} Speak naturally in short sentences. End the call with "goodbye" once a time is agreed, they decline, or ask not to be contacted.`,
  ].join("\n");
}

/** Job: hands the call to the voice provider. */
export async function executeCallStart(ctx: TenantContext, callId: string) {
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { lead: true } });
  if (!call) throw new NotFoundError("Call", callId);
  if (call.status !== "QUEUED") return { skipped: call.status };
  const provider = await resolveVoiceProvider(ctx);
  try {
    await assertCanCall(ctx, call.lead, call.toNumber, { providerIsMock: provider.isMock });
  } catch (error) {
    if (error instanceof CallBlockedError) {
      await ctx.db.call.update({ where: { id: call.id }, data: { status: "CANCELED", error: error.message } });
      await recordEvent(ctx, { type: "call_failed", leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel: "VOICE", properties: { reason: error.reason } });
      return { blocked: error.reason };
    }
    throw error;
  }
  const [compliance, seller] = await Promise.all([ctx.db.complianceSettings.findFirst(), sellerContext(ctx, {})]);
  const brief = call.brief as unknown as CallBrief;
  const appUrl = getEnv().APP_URL;
  try {
    const result = await provider.createCall({
      to: call.toNumber ?? "",
      agent: {
        firstMessage: brief.opening,
        systemPrompt: systemPrompt(brief, seller),
        language: "en",
        maxDurationSeconds: MAX_CALL_SECONDS,
        endCallPhrases: ["goodbye", "have a great day"],
        recordingEnabled: Boolean(compliance?.recordCalls),
      },
      metadata: { callId: call.id, organizationId: ctx.organizationId },
      webhookUrl: `${appUrl}/api/webhooks/voice/${provider.name}?call=${call.id}`,
      conversationUrl: `${appUrl}/api/webhooks/voice/twilio/turn?call=${call.id}`,
    });
    const now = new Date();
    await ctx.db.call.update({
      where: { id: call.id },
      data: { providerCallId: result.providerCallId, provider: provider.name, status: STATUS_MAP[result.status], startedAt: now, fromNumber: null, metadata: { ...meta(call), simulated: provider.isMock } as Prisma.InputJsonValue },
    });
    await recordEvent(ctx, { type: "call_started", leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel: "VOICE", properties: { provider: provider.name, simulated: provider.isMock } });
    const lead = await ctx.db.lead.findUniqueOrThrow({ where: { id: call.leadId }, select: { status: true } });
    if (["NEW", "QUALIFIED"].includes(lead.status)) {
      await ctx.db.lead.update({ where: { id: call.leadId }, data: { status: "CONTACTED" } });
      await recordEvent(ctx, { type: "lead_status_changed", leadId: call.leadId, properties: { from: lead.status, to: "CONTACTED", toLabel: "Contacted", reason: "AI call placed" } });
    }
    if (provider.isMock && getEnv().DEMO_SIMULATE_EVENTS) {
      await getQueue().enqueue("demo.simulate", { organizationId: ctx.organizationId, kind: "call", refId: call.id, step: "ringing" }, { jobId: `sim:${call.id}:ringing`, delayMs: 1_500 });
    }
    return { providerCallId: result.providerCallId };
  } catch (error) {
    const retryable = error instanceof IntegrationError ? error.retryable : true;
    logger.warn({ err: error, callId, retryable }, "voice provider rejected the call");
    if (retryable) throw error;
    await ctx.db.call.update({ where: { id: call.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : String(error), endedAt: new Date() } });
    await recordEvent(ctx, { type: "call_failed", leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel: "VOICE", properties: { reason: "provider_error" } });
    return { failed: true };
  }
}

// ----------------------------------------------------------------------------- Status & transcript

export interface CallStatusUpdate {
  status: VoiceCallStatus;
  at?: Date;
  answeredAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  endedReason?: string | null;
  costUsd?: number | null;
}

/** Applies a provider status (webhook, poll or simulator). Idempotent for repeated statuses. */
export async function applyCallStatus(ctx: TenantContext, callId: string, update: CallStatusUpdate) {
  const call = await ctx.db.call.findFirst({ where: { id: callId } });
  if (!call) throw new NotFoundError("Call", callId);
  if (["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELED"].includes(call.status)) return { ignored: "already ended" };
  const at = update.at ?? new Date();
  const status = STATUS_MAP[update.status];
  const channel = "VOICE" as const;
  const base = { leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel };

  if (update.status === "in_progress" && !call.answeredAt) {
    await ctx.db.call.update({ where: { id: call.id }, data: { status, answeredAt: update.answeredAt ?? at } });
    await recordEvent(ctx, { ...base, type: "call_answered", occurredAt: update.answeredAt ?? at, properties: { simulated: Boolean(meta(call).simulated) } });
    return { status };
  }
  if (!TERMINAL.includes(update.status)) {
    await ctx.db.call.update({ where: { id: call.id }, data: { status } });
    return { status };
  }

  const endedAt = update.endedAt ?? at;
  const answeredAt = call.answeredAt ?? update.answeredAt ?? null;
  const reached = update.status === "completed" && Boolean(answeredAt);
  const durationSeconds = update.durationSeconds ?? (answeredAt ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000)) : 0);
  const minutes = reached ? Math.max(1, Math.ceil(durationSeconds / 60)) : 0;
  const costCents = update.costUsd !== null && update.costUsd !== undefined ? Math.round(update.costUsd * 100) : Math.round(minutes * CHANNEL_UNIT_COST_USD.VOICE_PER_MINUTE * 100);
  await ctx.db.call.update({
    where: { id: call.id },
    data: {
      status: reached ? "COMPLETED" : update.status === "completed" ? "NO_ANSWER" : status,
      answeredAt,
      endedAt,
      durationSeconds,
      recordingUrl: update.recordingUrl ?? call.recordingUrl,
      costCents,
      metadata: { ...meta(call), endedReason: update.endedReason ?? null } as Prisma.InputJsonValue,
    },
  });

  if (reached) {
    if (minutes) {
      try {
        await consumeUsage(ctx, "VOICE_MINUTES", minutes, { sourceType: "call", sourceId: call.id, campaignId: call.campaignId, idempotencyKey: `call:${call.id}` });
      } catch (error) {
        // The call already happened; record the overage and tell the workspace.
        if (!isLimitError(error)) throw error;
        await notify(ctx, { type: "credits.low", title: "Voice minutes used up", body: "New AI calls are paused until minutes are added.", link: "/app/billing" });
      }
    }
    await getQueue().enqueue("calls.analyze", { organizationId: ctx.organizationId, callId: call.id }, { jobId: `call-analyze:${call.id}` });
    return { status: "COMPLETED" as const };
  }

  await recordEvent(ctx, { ...base, type: "call_failed", occurredAt: endedAt, properties: { status: update.status, reason: update.endedReason ?? null, simulated: Boolean(meta(call).simulated) } });
  const campaignLeadId = meta(call).campaignLeadId;
  if (campaignLeadId) await advanceSequence(ctx, campaignLeadId, endedAt);
  return { status };
}

export async function saveTranscript(ctx: TenantContext, callId: string, transcript: VoiceTranscript, provider: string) {
  await ctx.db.callTranscript.upsert({
    where: { callId },
    create: { callId, segments: transcript.segments as unknown as Prisma.InputJsonValue, fullText: transcript.fullText, language: transcript.language, provider },
    update: { segments: transcript.segments as unknown as Prisma.InputJsonValue, fullText: transcript.fullText, language: transcript.language },
  });
}

/** Appends live turns (turn-based providers and the simulator) so the call page can follow along. */
export async function appendTranscript(ctx: TenantContext, callId: string, segments: TranscriptSegment[], provider: string) {
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { transcript: true } });
  if (!call) throw new NotFoundError("Call", callId);
  const existing = (call.transcript?.segments ?? []) as unknown as TranscriptSegment[];
  const all = [...existing, ...segments];
  await saveTranscript(ctx, callId, { segments: all, fullText: transcriptText(all), language: "en" }, provider);
  return all;
}

// ----------------------------------------------------------------------------- Outcome

const POSITIVE: CallOutcome[] = ["INTERESTED", "MEETING_REQUESTED", "NEEDS_INFORMATION"];

async function applyOutcome(ctx: TenantContext, call: Call & { lead: { id: string; name: string; status: string } }, result: CallAnalysis, source: "ai" | "rules" | "manual") {
  const now = new Date();
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
  const followUpAt = result.followUpInDays !== null ? new Date(now.getTime() + result.followUpInDays * 86_400_000) : null;
  let metadata: CallMetadata = { ...meta(call), analysis: { interestLevel: result.interestLevel, keyPoints: result.keyPoints, objections: result.objections, meetingRequested: result.meetingRequested, optOut: result.optOut, source } };

  const lead = call.lead;
  const setLeadStatus = async (to: string, label: string, reason: string) => {
    if (lead.status === to || ["WON", "LOST", "DO_NOT_CONTACT"].includes(lead.status)) return;
    await ctx.db.lead.update({ where: { id: lead.id }, data: { status: to as never } });
    await recordEvent(ctx, { type: "lead_status_changed", leadId: lead.id, properties: { from: lead.status, to, toLabel: label, reason } });
  };

  if (result.optOut || result.outcome === "DO_NOT_CONTACT") {
    await addSuppression(ctx, { leadId: lead.id, phone: call.toNumber }, { reason: "OPT_OUT", sourceType: "call", sourceId: call.id });
    await recordEvent(ctx, { type: "opt_out", leadId: lead.id, campaignId: call.campaignId, callId: call.id, channel: "VOICE", properties: { source: "call" } });
  } else if (result.outcome === "MEETING_REQUESTED") {
    const said = [...((await ctx.db.callTranscript.findUnique({ where: { callId: call.id } }))?.segments as unknown as TranscriptSegment[] | undefined ?? [])]
      .reverse()
      .find((segment) => segment.speaker === "prospect" && parseSuggestedTime(segment.text, org.timezone, now));
    const scheduledAt = said ? parseSuggestedTime(said.text, org.timezone, now) : null;
    if (scheduledAt) {
      const meeting = await ctx.db.meeting.create({
        data: { organizationId: ctx.organizationId, leadId: lead.id, title: `Intro call — ${lead.name}`, scheduledAt, durationMinutes: 30, source: "call", sourceId: call.id, createdById: ctx.userId },
      });
      metadata = { ...metadata, meetingId: meeting.id };
      await recordEvent(ctx, { type: "meeting_created", leadId: lead.id, campaignId: call.campaignId, callId: call.id, channel: "VOICE", properties: { meetingId: meeting.id, scheduledAt: scheduledAt.toISOString(), suggested: said?.text } });
      await setLeadStatus("MEETING", "Meeting", "Meeting agreed on a call");
    } else {
      await setLeadStatus("INTERESTED", "Interested", "Asked for a meeting on a call");
    }
    await ctx.db.task.create({
      data: { organizationId: ctx.organizationId, leadId: lead.id, title: scheduledAt ? `Send the calendar invite to ${lead.name}` : `Agree a meeting time with ${lead.name}`, description: result.summary, type: "MEETING", priority: "HIGH", dueAt: now, assigneeId: ctx.userId, createdById: ctx.userId },
    });
  } else if (POSITIVE.includes(result.outcome)) {
    await setLeadStatus("INTERESTED", "Interested", `Call outcome: ${result.outcome.toLowerCase().replace(/_/g, " ")}`);
    await ctx.db.task.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, title: `${result.nextAction} — ${lead.name}`, type: "FOLLOW_UP", priority: "HIGH", dueAt: followUpAt ?? now, assigneeId: ctx.userId, createdById: ctx.userId } });
  } else if (result.outcome === "CALL_BACK_LATER") {
    await ctx.db.task.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, title: `Call ${lead.name} back`, description: result.summary, type: "CALL", priority: "MEDIUM", dueAt: followUpAt ?? new Date(now.getTime() + 7 * 86_400_000), assigneeId: ctx.userId, createdById: ctx.userId } });
  } else if (result.outcome === "WRONG_CONTACT") {
    await ctx.db.task.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, title: `Find the right contact at ${lead.name}`, type: "TODO", priority: "MEDIUM", dueAt: new Date(now.getTime() + 2 * 86_400_000), assigneeId: ctx.userId, createdById: ctx.userId } });
  }

  await ctx.db.call.update({
    where: { id: call.id },
    data: { outcome: result.outcome, summary: result.summary, sentiment: result.sentiment, nextAction: result.nextAction, followUpAt, metadata: metadata as Prisma.InputJsonValue },
  });
  await recordEvent(ctx, {
    type: "call_completed",
    leadId: lead.id,
    campaignId: call.campaignId,
    callId: call.id,
    channel: call.type === "AI_AGENT" ? "VOICE" : "MANUAL_CALL",
    occurredAt: call.endedAt ?? now,
    value: call.durationSeconds ?? 0,
    properties: { outcome: result.outcome, durationSeconds: call.durationSeconds ?? 0, sentiment: result.sentiment, source, simulated: Boolean(meta(call).simulated) },
    idempotencyKey: `call_completed:${call.id}`,
  });

  // Campaign sequence: a positive or final answer stops it; otherwise continue with the next step.
  const campaignLeadId = meta(call).campaignLeadId;
  if (campaignLeadId) {
    if (result.optOut || result.outcome === "DO_NOT_CONTACT") {
      await ctx.db.campaignLead.updateMany({ where: { id: campaignLeadId }, data: { status: "OPTED_OUT", nextActionAt: null, stoppedReason: "Asked not to be called" } });
    } else if (POSITIVE.includes(result.outcome)) {
      await ctx.db.campaignLead.updateMany({ where: { id: campaignLeadId }, data: { status: "REPLIED", nextActionAt: null, stoppedReason: "Positive call" } });
    } else if (["NOT_INTERESTED", "WRONG_CONTACT"].includes(result.outcome)) {
      await ctx.db.campaignLead.updateMany({ where: { id: campaignLeadId }, data: { status: "STOPPED", nextActionAt: null, stoppedReason: result.outcome === "WRONG_CONTACT" ? "Wrong contact" : "Not interested" } });
    } else {
      await advanceSequence(ctx, campaignLeadId, call.endedAt ?? now);
    }
  }
}

/** Job: analyses the transcript and applies the outcome. Falls back to rules if AI is unavailable. */
export async function analyzeCall(ctx: TenantContext, callId: string) {
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { lead: { select: { id: true, name: true, status: true } }, transcript: true } });
  if (!call) throw new NotFoundError("Call", callId);
  if (call.outcome) return { skipped: "already analysed" };
  const compliance = await ctx.db.complianceSettings.findFirst({ select: { optOutKeywords: true } });
  const seller = await sellerContext(ctx, {});
  const segments = (call.transcript?.segments ?? []) as unknown as TranscriptSegment[];
  const input = {
    leadName: call.lead.name,
    sellerName: seller.businessName,
    transcript: segments.map((segment) => ({ speaker: segment.speaker, text: segment.text })),
    durationSeconds: call.durationSeconds ?? 0,
    optOutKeywords: compliance?.optOutKeywords ?? [],
  };
  let result: CallAnalysis;
  let source: "ai" | "rules" = "ai";
  try {
    result = (await runAgent(ctx, callAnalysisAgent, input, { leadId: call.leadId, campaignId: call.campaignId })).output;
  } catch (error) {
    logger.warn({ err: error, callId }, "call analysis failed; using rules");
    result = analyzeCallDeterministically(input);
    source = "rules";
  }
  // Safety net: an explicit opt-out in the transcript always wins.
  const rules = analyzeCallDeterministically(input);
  if (rules.optOut && !result.optOut) result = { ...result, optOut: true, outcome: "DO_NOT_CONTACT" };
  await applyOutcome(ctx, call, result, source);
  return { outcome: result.outcome };
}

export const manualOutcomeSchema = z.object({
  outcome: z.enum(["INTERESTED", "NOT_INTERESTED", "CALL_BACK_LATER", "NEEDS_INFORMATION", "MEETING_REQUESTED", "WRONG_CONTACT", "DO_NOT_CONTACT", "UNKNOWN"]),
  notes: z.string().trim().max(2000).default(""),
  durationMinutes: z.number().int().min(0).max(240).default(0),
  reached: z.boolean().default(true),
});

/** A person made the call themselves; they record what happened. */
export async function logManualCall(ctx: TenantContext, callId: string, input: z.input<typeof manualOutcomeSchema>) {
  assertCan(ctx, "calls:place");
  const data = manualOutcomeSchema.parse(input);
  const call = await ctx.db.call.findFirst({ where: { id: callId }, include: { lead: { select: { id: true, name: true, status: true } } } });
  if (!call) throw new NotFoundError("Call", callId);
  if (call.type !== "MANUAL") throw new PreconditionError("Only manual calls are logged by hand");
  if (call.outcome || ["COMPLETED", "NO_ANSWER", "CANCELED"].includes(call.status)) throw new PreconditionError("This call has already been logged");
  const now = new Date();
  if (!data.reached) {
    await ctx.db.call.update({ where: { id: call.id }, data: { status: "NO_ANSWER", endedAt: now, startedAt: call.startedAt ?? now, summary: data.notes || null } });
    await recordEvent(ctx, { type: "call_failed", leadId: call.leadId, campaignId: call.campaignId, callId: call.id, channel: "MANUAL_CALL", properties: { status: "no_answer", manual: true } });
    const campaignLeadId = meta(call).campaignLeadId;
    if (campaignLeadId) await advanceSequence(ctx, campaignLeadId, now);
    return { status: "NO_ANSWER" as const };
  }
  const updated = await ctx.db.call.update({
    where: { id: call.id },
    data: { status: "COMPLETED", startedAt: call.startedAt ?? now, answeredAt: call.answeredAt ?? call.startedAt ?? now, endedAt: now, durationSeconds: data.durationMinutes * 60 },
    include: { lead: { select: { id: true, name: true, status: true } } },
  });
  const optOut = data.outcome === "DO_NOT_CONTACT";
  await applyOutcome(
    ctx,
    updated,
    {
      outcome: data.outcome,
      summary: data.notes || `Manual call — ${data.outcome.toLowerCase().replace(/_/g, " ")}.`,
      sentiment: POSITIVE.includes(data.outcome) ? "POSITIVE" : ["NOT_INTERESTED", "DO_NOT_CONTACT", "WRONG_CONTACT"].includes(data.outcome) ? "NEGATIVE" : "NEUTRAL",
      interestLevel: { MEETING_REQUESTED: 85, INTERESTED: 70, NEEDS_INFORMATION: 55, CALL_BACK_LATER: 40, UNKNOWN: 25, NOT_INTERESTED: 10, WRONG_CONTACT: 0, DO_NOT_CONTACT: 0 }[data.outcome],
      keyPoints: data.notes ? [data.notes] : [],
      objections: [],
      nextAction: { MEETING_REQUESTED: "Send the calendar invite", INTERESTED: "Follow up with details", NEEDS_INFORMATION: "Send the requested information", CALL_BACK_LATER: "Call back later", NOT_INTERESTED: "Close the lead", WRONG_CONTACT: "Find the right contact", DO_NOT_CONTACT: "Do not contact again", UNKNOWN: "Follow up" }[data.outcome],
      followUpInDays: data.outcome === "CALL_BACK_LATER" ? 7 : POSITIVE.includes(data.outcome) ? 2 : null,
      meetingRequested: data.outcome === "MEETING_REQUESTED",
      optOut,
    },
    "manual",
  );
  return { status: "COMPLETED" as const };
}

export async function cancelCall(ctx: TenantContext, callId: string) {
  assertCan(ctx, "calls:place");
  const call = await ctx.db.call.findFirst({ where: { id: callId } });
  if (!call) throw new NotFoundError("Call", callId);
  if (!["PREPARED", "QUEUED"].includes(call.status)) throw new PreconditionError("Only calls that haven't started can be canceled");
  await ctx.db.call.update({ where: { id: call.id }, data: { status: "CANCELED", endedAt: new Date() } });
  const campaignLeadId = meta(call).campaignLeadId;
  if (campaignLeadId) {
    await ctx.db.campaignLead.updateMany({ where: { id: campaignLeadId, status: { in: ["AWAITING_APPROVAL", "IN_SEQUENCE"] } }, data: { status: "IN_SEQUENCE" } });
    await advanceSequence(ctx, campaignLeadId);
  }
}

/** Ends a live AI call. */
export async function hangUpCall(ctx: TenantContext, callId: string) {
  assertCan(ctx, "calls:place");
  const call = await ctx.db.call.findFirst({ where: { id: callId } });
  if (!call) throw new NotFoundError("Call", callId);
  if (!["RINGING", "IN_PROGRESS"].includes(call.status) || call.type !== "AI_AGENT") throw new PreconditionError("This call isn't live");
  const provider = await resolveVoiceProvider(ctx);
  if (provider.isMock) {
    await patchMeta(ctx, call, { hangupRequested: true });
    return;
  }
  if (!call.providerCallId) throw new PreconditionError("The provider hasn't confirmed this call yet");
  await provider.endCall(call.providerCallId);
}

// ----------------------------------------------------------------------------- Read

export const callFiltersSchema = z.object({
  view: z.enum(["queue", "live", "history", "all"]).default("all"),
  outcome: z.enum(["INTERESTED", "NOT_INTERESTED", "CALL_BACK_LATER", "NEEDS_INFORMATION", "MEETING_REQUESTED", "WRONG_CONTACT", "DO_NOT_CONTACT", "UNKNOWN"]).optional(),
  leadId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const VIEW_STATUSES: Record<string, Array<Call["status"]>> = {
  queue: ["PREPARED", "QUEUED"],
  live: ["RINGING", "IN_PROGRESS"],
  history: ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELED"],
};

export async function listCalls(ctx: TenantContext, filters: z.input<typeof callFiltersSchema> = {}) {
  assertCan(ctx, "conversations:read");
  const input = callFiltersSchema.parse(filters);
  const where: Prisma.CallWhereInput = {
    ...(input.view !== "all" ? { status: { in: VIEW_STATUSES[input.view] } } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.leadId ? { leadId: input.leadId } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    // Calls on deleted leads leave the workspace views with the lead.
    lead: { deletedAt: null, ...(input.q ? { name: { contains: input.q, mode: "insensitive" as const } } : {}) },
  };
  const [items, total, counts] = await Promise.all([
    ctx.db.call.findMany({
      where,
      orderBy: input.view === "queue" ? [{ createdAt: "asc" }] : [{ createdAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: { lead: { select: { id: true, name: true, city: true, locality: true, score: true, category: true } }, campaign: { select: { id: true, name: true } } },
    }),
    ctx.db.call.count({ where }),
    ctx.db.call.groupBy({ by: ["status"], where: { lead: { deletedAt: null } }, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Partial<Record<Call["status"], number>>;
  const sum = (statuses: Array<Call["status"]>) => statuses.reduce((total, status) => total + (byStatus[status] ?? 0), 0);
  return { items, total, page: input.page, pageSize: input.pageSize, counts: { queue: sum(VIEW_STATUSES.queue ?? []), live: sum(VIEW_STATUSES.live ?? []), history: sum(VIEW_STATUSES.history ?? []) } };
}

export async function getCall(ctx: TenantContext, callId: string) {
  assertCan(ctx, "conversations:read");
  const call = await ctx.db.call.findFirst({
    where: { id: callId },
    include: {
      lead: { select: { id: true, name: true, city: true, locality: true, score: true, category: true, status: true, phone: true, doNotContact: true, sourceProvider: true } },
      contact: { select: { id: true, name: true, title: true, phone: true } },
      campaign: { select: { id: true, name: true, automationMode: true } },
      transcript: true,
    },
  });
  if (!call) throw new NotFoundError("Call", callId);
  const meeting = meta(call).meetingId ? await ctx.db.meeting.findFirst({ where: { id: meta(call).meetingId }, select: { id: true, title: true, scheduledAt: true, status: true } }) : null;
  return { ...call, meeting };
}

// ----------------------------------------------------------------------------- Campaign voice steps

registerVoiceStepHandler(async (ctx, input) => {
  // One call per lead per step, even if the sequence tick fires again.
  const existing = await ctx.db.call.findFirst({
    where: { leadId: input.leadId, campaignId: input.campaignId, status: { not: "CANCELED" }, metadata: { path: ["stepName"], equals: input.stepName } },
    select: { status: true },
  });
  if (existing) return { status: existing.status };
  const campaign = await ctx.db.campaign.findFirstOrThrow({ where: { id: input.campaignId }, select: { automationMode: true } });
  const call = await prepareCall(ctx, { leadId: input.leadId, type: "AI_AGENT", campaignId: input.campaignId }, { campaignLeadId: input.campaignLeadId, stepName: input.stepName });
  if (campaign.automationMode !== "AUTOMATED") {
    await ctx.db.campaignLead.update({ where: { id: input.campaignLeadId }, data: { status: "AWAITING_APPROVAL", nextActionAt: null } });
    return { status: "PREPARED" };
  }
  await ctx.db.campaignLead.update({ where: { id: input.campaignLeadId }, data: { nextActionAt: null } });
  try {
    const started = await startCall(ctx, call.id, { confirm: true });
    return { status: started.status };
  } catch (error) {
    await ctx.db.call.update({ where: { id: call.id }, data: { status: "CANCELED", error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
});
