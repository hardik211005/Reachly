import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { IntegrationError, TwilioVoiceProvider, twiml, type TranscriptSegment, type VoiceWebhookEvent, type WebhookRequest } from "@repo/integrations";
import { decideVoiceTurn, voiceTurnAgent, type CallBrief, type VoiceTurn } from "../ai/agents/calls";
import { runAgent } from "../ai/service";
import { systemContext, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { logger } from "../logger";
import { registerWebhookHandler, storeWebhookEvent, WebhookSignatureError } from "../outreach/webhooks";
import { resolveVoiceProvider } from "./providers";
import { appendTranscript, applyCallStatus, saveTranscript } from "./service";

/** Voice provider webhooks: verified with the workspace's provider, stored once, processed on the queue. */

async function callContext(callId: string | null | undefined, providerName: string, providerCallId?: string | null) {
  const call = callId
    ? await prisma.call.findUnique({ where: { id: callId }, select: { id: true, organizationId: true } })
    : providerCallId
      ? await prisma.call.findFirst({ where: { provider: providerName, providerCallId }, select: { id: true, organizationId: true } })
      : null;
  return call ? { call, ctx: systemContext(call.organizationId, { type: "PROVIDER", id: providerName }) } : null;
}

function unverifiedCallId(providerName: string, request: WebhookRequest): string | null {
  const fromUrl = new URL(request.url).searchParams.get("call");
  if (fromUrl) return fromUrl;
  if (providerName !== "vapi") return null;
  try {
    const payload = JSON.parse(request.rawBody) as { message?: { call?: { metadata?: { callId?: string } } } };
    return payload.message?.call?.metadata?.callId ?? null;
  } catch {
    return null;
  }
}

export async function ingestVoiceWebhook(providerName: string, request: WebhookRequest) {
  // The call id only selects which workspace's credentials verify the request.
  const found = await callContext(unverifiedCallId(providerName, request), providerName);
  if (!found) return { accepted: 0, ignored: 1 };
  const provider = await resolveVoiceProvider(found.ctx);
  if (provider.name !== providerName) throw new WebhookSignatureError(providerName);
  let events: VoiceWebhookEvent[];
  try {
    events = provider.handleWebhook(request);
  } catch (error) {
    if (error instanceof IntegrationError || error instanceof SyntaxError) throw new WebhookSignatureError(providerName);
    throw error;
  }
  const result = { accepted: 0, duplicates: 0, ignored: 0 };
  for (const event of events) {
    const outcome = await storeWebhookEvent(`voice_${providerName}`, found.call.organizationId, event.type === "status" ? `status.${event.status}` : "transcript", event.externalEventId, {
      kind: "voice",
      callId: event.callId ?? found.call.id,
      event: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
    });
    if (outcome === "duplicate") result.duplicates += 1;
    else result.accepted += 1;
  }
  return result;
}

/** Applies a stored voice event (called by the webhooks processor). */
export async function applyVoiceEvent(ctx: TenantContext, callId: string, event: Record<string, unknown>, provider: string) {
  if (event.type === "transcript") {
    const transcript = event.transcript as { segments: TranscriptSegment[]; fullText: string; language: string };
    return saveTranscript(ctx, callId, transcript, provider);
  }
  const date = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  return applyCallStatus(ctx, callId, {
    status: event.status as Parameters<typeof applyCallStatus>[2]["status"],
    at: date(event.at) ?? new Date(),
    answeredAt: date(event.answeredAt),
    endedAt: date(event.endedAt),
    durationSeconds: typeof event.durationSeconds === "number" ? event.durationSeconds : null,
    recordingUrl: typeof event.recordingUrl === "string" ? event.recordingUrl : null,
    endedReason: typeof event.endedReason === "string" ? event.endedReason : null,
    costUsd: typeof event.costUsd === "number" ? event.costUsd : null,
  });
}

registerWebhookHandler("voice", async (ctx, stored, provider) => {
  if (!stored.callId) return { ignored: "no call" };
  return applyVoiceEvent(ctx, stored.callId, stored.event, provider.replace(/^voice_/, ""));
});

// ----------------------------------------------------------------------------- Twilio conversation

const MAX_AGENT_TURNS = 7;
const TURN_TIMEOUT_MS = 6_000;

/**
 * One turn of a Twilio call: record what the prospect said, decide the next line (AI with
 * a rule-based fallback so the caller never hears silence), and answer with TwiML.
 */
export async function twilioConversationTurn(request: WebhookRequest): Promise<string> {
  const callId = new URL(request.url).searchParams.get("call");
  const found = await callContext(callId, "twilio");
  if (!found) return twiml({ say: [], hangup: true });
  const { ctx } = found;
  const provider = await resolveVoiceProvider(ctx);
  if (!(provider instanceof TwilioVoiceProvider)) throw new WebhookSignatureError("twilio");
  let params: Record<string, string>;
  try {
    params = provider.verifyForm(request);
  } catch {
    throw new WebhookSignatureError("twilio");
  }

  const call = await ctx.db.call.findFirst({ where: { id: found.call.id }, include: { transcript: true } });
  if (!call) throw new NotFoundError("Call", found.call.id);
  if (["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELED"].includes(call.status)) return twiml({ say: [], hangup: true });
  if (!call.answeredAt) await applyCallStatus(ctx, call.id, { status: "in_progress" });

  const answeredAt = call.answeredAt ?? new Date();
  const now = Date.now() - answeredAt.getTime();
  let segments = (call.transcript?.segments ?? []) as unknown as TranscriptSegment[];
  const speech = params.SpeechResult?.trim();
  if (speech) segments = await appendTranscript(ctx, call.id, [{ speaker: "prospect", text: speech, startMs: Math.max(0, now - 3_000), endMs: now }], "twilio");

  const silence = new URL(request.url).searchParams.get("silence") === "1" && !speech;
  const [compliance, seller] = await Promise.all([ctx.db.complianceSettings.findFirst({ select: { optOutKeywords: true } }), ctx.db.businessProfile.findFirst({ select: { name: true } })]);
  const input = {
    brief: call.brief as unknown as CallBrief,
    sellerName: seller?.name ?? "our team",
    transcript: segments.map((segment) => ({ speaker: segment.speaker, text: segment.text })),
    optOutKeywords: compliance?.optOutKeywords ?? [],
    maxTurns: MAX_AGENT_TURNS,
  };
  let turn: VoiceTurn;
  if (silence) {
    const alreadyPrompted = segments.at(-1)?.speaker === "agent" && segments.at(-1)?.text.startsWith("Sorry, I didn't catch");
    turn = alreadyPrompted
      ? { say: "It sounds like this isn't a good moment — I'll follow up by email instead. Goodbye!", end: true, reason: "completed" }
      : { say: "Sorry, I didn't catch that — is now an okay time for a quick chat?", end: false, reason: "continue" };
  } else if (!segments.length) {
    turn = { say: input.brief.opening, end: false, reason: "continue" };
  } else {
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn timeout")), TURN_TIMEOUT_MS));
      turn = (await Promise.race([runAgent(ctx, voiceTurnAgent, input, { leadId: call.leadId, campaignId: call.campaignId }), timeout])).output;
    } catch (error) {
      logger.warn({ err: error, callId: call.id }, "voice turn fell back to rules");
      turn = decideVoiceTurn(input);
    }
  }
  const spokenAt = Date.now() - answeredAt.getTime();
  await appendTranscript(ctx, call.id, [{ speaker: "agent", text: turn.say, startMs: spokenAt, endMs: spokenAt + Math.round((turn.say.split(/\s+/).length / 2.6) * 1000) }], "twilio");
  const action = `${getEnv().APP_URL}/api/webhooks/voice/twilio/turn?call=${call.id}`;
  return turn.end ? twiml({ say: [turn.say], hangup: true }) : twiml({ say: [turn.say], gather: { action, language: "en-IN" } });
}
