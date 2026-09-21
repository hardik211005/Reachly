import { randomUUID } from "node:crypto";
import type { WebhookRequest } from "../email/types";
import { IntegrationError, providerFetch } from "../lib/errors";
import { safeEqual, verifyTwilioSignature } from "../lib/signatures";
import {
  transcriptText,
  type TranscriptSegment,
  type VoiceCallDetails,
  type VoiceCallRequest,
  type VoiceCallResult,
  type VoiceCallStatus,
  type VoiceProvider,
  type VoiceTranscript,
  type VoiceWebhookEvent,
} from "./types";

// ----------------------------------------------------------------------------- Vapi (hosted AI voice agent)

interface VapiMessage {
  role?: string;
  message?: string;
  secondsFromStart?: number;
  /** Epoch milliseconds. */
  time?: number;
  endTime?: number;
}

interface VapiCall {
  id: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  metadata?: Record<string, string>;
  monitor?: { controlUrl?: string };
  artifact?: { recordingUrl?: string; messages?: VapiMessage[] };
  recordingUrl?: string;
  messages?: VapiMessage[];
}

const VAPI_NOT_REACHED: Record<string, VoiceCallStatus> = {
  "customer-did-not-answer": "no_answer",
  "customer-busy": "busy",
  "voicemail": "no_answer",
  "customer-ended-call-before-connected": "no_answer",
};

function vapiStatus(call: { status?: string; endedReason?: string }): VoiceCallStatus {
  switch (call.status) {
    case "queued":
      return "queued";
    case "ringing":
      return "ringing";
    case "in-progress":
    case "forwarding":
      return "in_progress";
    case "ended":
      if (call.endedReason && VAPI_NOT_REACHED[call.endedReason]) return VAPI_NOT_REACHED[call.endedReason] as VoiceCallStatus;
      return call.endedReason?.includes("error") || call.endedReason?.includes("failed") ? "failed" : "completed";
    default:
      return "queued";
  }
}

function vapiSegments(messages: VapiMessage[] | undefined): TranscriptSegment[] {
  return (messages ?? [])
    .filter((message) => message.message && ["assistant", "bot", "user"].includes(message.role ?? ""))
    .map((message) => {
      const startMs = Math.round((message.secondsFromStart ?? 0) * 1000);
      return {
        speaker: message.role === "user" ? ("prospect" as const) : ("agent" as const),
        text: message.message ?? "",
        startMs,
        endMs: startMs + (message.time && message.endTime ? Math.max(0, message.endTime - message.time) : 0),
      };
    });
}

/**
 * Vapi runs the conversation (speech-to-text, LLM, text-to-speech) with a transient
 * assistant built from our call brief. Webhooks carry status updates and the
 * end-of-call report (transcript, recording, cost), authenticated with `x-vapi-secret`.
 */
export class VapiVoiceProvider implements VoiceProvider {
  readonly name = "vapi";
  readonly isMock = false;
  readonly capabilities = { hostedAgent: true, recording: true, transcription: true };
  private readonly base = "https://api.vapi.ai";

  constructor(private readonly options: { apiKey: string; phoneNumberId: string; webhookSecret?: string; model?: string }) {}

  private headers() {
    return { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" };
  }

  async createCall(request: VoiceCallRequest): Promise<VoiceCallResult> {
    const response = await providerFetch("vapi", `${this.base}/call`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        phoneNumberId: this.options.phoneNumberId,
        customer: { number: request.to },
        metadata: request.metadata,
        assistant: {
          firstMessage: request.agent.firstMessage,
          model: { provider: "openai", model: this.options.model ?? "gpt-4o-mini", messages: [{ role: "system", content: request.agent.systemPrompt }] },
          ...(request.agent.voice ? { voice: { provider: "11labs", voiceId: request.agent.voice } } : {}),
          endCallPhrases: request.agent.endCallPhrases,
          maxDurationSeconds: request.agent.maxDurationSeconds,
          artifactPlan: { recordingEnabled: request.agent.recordingEnabled },
          server: { url: request.webhookUrl, ...(this.options.webhookSecret ? { secret: this.options.webhookSecret } : {}) },
          metadata: request.metadata,
        },
      }),
    });
    const call = (await response.json()) as VapiCall;
    return { providerCallId: call.id, status: vapiStatus(call) };
  }

  private async fetchCall(providerCallId: string): Promise<VapiCall> {
    const response = await providerFetch("vapi", `${this.base}/call/${encodeURIComponent(providerCallId)}`, { headers: this.headers() });
    return (await response.json()) as VapiCall;
  }

  async endCall(providerCallId: string): Promise<void> {
    const call = await this.fetchCall(providerCallId);
    if (!call.monitor?.controlUrl) throw new IntegrationError("vapi", "This call can't be controlled (no control URL)", null, false);
    await providerFetch("vapi", call.monitor.controlUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "end-call" }) });
  }

  async getCallStatus(providerCallId: string): Promise<VoiceCallDetails> {
    const call = await this.fetchCall(providerCallId);
    const startedAt = call.startedAt ? new Date(call.startedAt) : null;
    const endedAt = call.endedAt ? new Date(call.endedAt) : null;
    return {
      providerCallId,
      status: vapiStatus(call),
      startedAt,
      answeredAt: startedAt,
      endedAt,
      durationSeconds: startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null,
      recordingUrl: call.artifact?.recordingUrl ?? call.recordingUrl ?? null,
      endedReason: call.endedReason ?? null,
      costUsd: call.cost ?? null,
    };
  }

  async getRecording(providerCallId: string): Promise<{ url: string } | null> {
    const call = await this.fetchCall(providerCallId);
    const url = call.artifact?.recordingUrl ?? call.recordingUrl;
    return url ? { url } : null;
  }

  async getTranscript(providerCallId: string): Promise<VoiceTranscript | null> {
    const call = await this.fetchCall(providerCallId);
    const segments = vapiSegments(call.artifact?.messages ?? call.messages);
    return segments.length ? { segments, fullText: transcriptText(segments), language: "en" } : null;
  }

  handleWebhook(request: WebhookRequest): VoiceWebhookEvent[] {
    if (!this.options.webhookSecret || !safeEqual(request.headers.get("x-vapi-secret") ?? "", this.options.webhookSecret)) {
      throw new IntegrationError("vapi", "Invalid webhook secret", 401, false);
    }
    const payload = JSON.parse(request.rawBody) as {
      message?: {
        type?: string;
        status?: string;
        endedReason?: string;
        timestamp?: number;
        startedAt?: string;
        endedAt?: string;
        durationSeconds?: number;
        cost?: number;
        call?: VapiCall;
        artifact?: { recordingUrl?: string; messages?: VapiMessage[] };
      };
    };
    const message = payload.message;
    const call = message?.call;
    if (!message || !call?.id) return [];
    const at = message.timestamp ? new Date(message.timestamp) : new Date();
    const callId = call.metadata?.callId;
    if (message.type === "status-update") {
      const status = vapiStatus({ status: message.status, endedReason: message.endedReason });
      return [{ type: "status", externalEventId: `${call.id}:status:${message.status}`, providerCallId: call.id, callId, at, status, ...(status === "in_progress" ? { answeredAt: at } : {}) }];
    }
    if (message.type === "end-of-call-report") {
      const segments = vapiSegments(message.artifact?.messages);
      const startedAt = message.startedAt ? new Date(message.startedAt) : null;
      const endedAt = message.endedAt ? new Date(message.endedAt) : at;
      const events: VoiceWebhookEvent[] = [
        {
          type: "status",
          externalEventId: `${call.id}:ended`,
          providerCallId: call.id,
          callId,
          at: endedAt,
          status: vapiStatus({ status: "ended", endedReason: message.endedReason }),
          startedAt,
          endedAt,
          durationSeconds: message.durationSeconds ?? (startedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null),
          recordingUrl: message.artifact?.recordingUrl ?? null,
          endedReason: message.endedReason ?? null,
          costUsd: message.cost ?? null,
        },
      ];
      if (segments.length) {
        events.unshift({ type: "transcript", externalEventId: `${call.id}:transcript`, providerCallId: call.id, callId, transcript: { segments, fullText: transcriptText(segments), language: "en" } });
      }
      return events;
    }
    return [];
  }
}

// ----------------------------------------------------------------------------- Twilio (telephony)

const TWILIO_STATUS: Record<string, VoiceCallStatus> = {
  queued: "queued",
  initiated: "queued",
  ringing: "ringing",
  "in-progress": "in_progress",
  answered: "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

/**
 * Twilio places and records the call; the conversation itself is driven turn by turn
 * over TwiML webhooks (`<Say>` + speech `<Gather>`), with our AI deciding each reply.
 * Webhooks are verified with `X-Twilio-Signature`.
 */
export class TwilioVoiceProvider implements VoiceProvider {
  readonly name = "twilio";
  readonly isMock = false;
  readonly capabilities = { hostedAgent: false, recording: true, transcription: false };

  constructor(private readonly options: { accountSid: string; authToken: string; fromNumber: string }) {}

  private get base() {
    return `https://api.twilio.com/2010-04-01/Accounts/${this.options.accountSid}`;
  }

  private headers(form = false) {
    return {
      authorization: `Basic ${Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString("base64")}`,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    };
  }

  async createCall(request: VoiceCallRequest): Promise<VoiceCallResult> {
    if (!request.conversationUrl) throw new IntegrationError("twilio", "A conversation URL is required", null, false);
    const body = new URLSearchParams({
      To: request.to,
      From: request.from ?? this.options.fromNumber,
      Url: request.conversationUrl,
      Method: "POST",
      StatusCallback: request.webhookUrl,
      StatusCallbackMethod: "POST",
      Record: request.agent.recordingEnabled ? "true" : "false",
      Timeout: "25",
      TimeLimit: String(request.agent.maxDurationSeconds),
    });
    for (const event of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", event);
    const response = await providerFetch("twilio", `${this.base}/Calls.json`, { method: "POST", headers: this.headers(true), body });
    const call = (await response.json()) as { sid: string; status: string };
    return { providerCallId: call.sid, status: TWILIO_STATUS[call.status] ?? "queued" };
  }

  async endCall(providerCallId: string): Promise<void> {
    await providerFetch("twilio", `${this.base}/Calls/${providerCallId}.json`, { method: "POST", headers: this.headers(true), body: new URLSearchParams({ Status: "completed" }) });
  }

  async getCallStatus(providerCallId: string): Promise<VoiceCallDetails> {
    const response = await providerFetch("twilio", `${this.base}/Calls/${providerCallId}.json`, { headers: this.headers() });
    const call = (await response.json()) as { status: string; start_time?: string | null; end_time?: string | null; duration?: string | null; price?: string | null };
    return {
      providerCallId,
      status: TWILIO_STATUS[call.status] ?? "queued",
      startedAt: call.start_time ? new Date(call.start_time) : null,
      answeredAt: call.start_time ? new Date(call.start_time) : null,
      endedAt: call.end_time ? new Date(call.end_time) : null,
      durationSeconds: call.duration ? Number(call.duration) : null,
      costUsd: call.price ? Math.abs(Number(call.price)) : null,
    };
  }

  async getRecording(providerCallId: string): Promise<{ url: string } | null> {
    const response = await providerFetch("twilio", `${this.base}/Calls/${providerCallId}/Recordings.json`, { headers: this.headers() });
    const data = (await response.json()) as { recordings?: Array<{ uri: string }> };
    const uri = data.recordings?.[0]?.uri;
    return uri ? { url: `https://api.twilio.com${uri.replace(/\.json$/, ".mp3")}` } : null;
  }

  async getTranscript(): Promise<VoiceTranscript | null> {
    // Turns are captured by our conversation webhook, not by Twilio.
    return null;
  }

  /** Verifies a Twilio form POST; returns the parsed params. */
  verifyForm(request: WebhookRequest): Record<string, string> {
    const params = Object.fromEntries(new URLSearchParams(request.rawBody));
    if (!verifyTwilioSignature(this.options.authToken, request.headers.get("x-twilio-signature"), request.url, params)) {
      throw new IntegrationError("twilio", "Invalid signature", 401, false);
    }
    return params;
  }

  handleWebhook(request: WebhookRequest): VoiceWebhookEvent[] {
    const params = this.verifyForm(request);
    const sid = params.CallSid;
    if (!sid || !params.CallStatus) return [];
    const status = TWILIO_STATUS[params.CallStatus] ?? "queued";
    const callId = new URL(request.url).searchParams.get("call") ?? undefined;
    const at = params.Timestamp ? new Date(params.Timestamp) : new Date();
    return [
      {
        type: "status",
        externalEventId: `${sid}:${params.CallStatus}:${params.SequenceNumber ?? ""}`,
        providerCallId: sid,
        callId,
        at,
        status,
        ...(status === "in_progress" ? { answeredAt: at } : {}),
        ...(["completed", "busy", "no_answer", "failed", "canceled"].includes(status) ? { endedAt: at } : {}),
        durationSeconds: params.CallDuration ? Number(params.CallDuration) : null,
        recordingUrl: params.RecordingUrl ? `${params.RecordingUrl}.mp3` : null,
      },
    ];
  }
}

// ----------------------------------------------------------------------------- TwiML

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char);
}

/** Minimal TwiML builder for the turn-based conversation. */
export function twiml(options: { say: string[]; gather?: { action: string; language: string; timeoutSeconds?: number }; hangup?: boolean; voice?: string }): string {
  const voice = options.voice ?? "Polly.Joanna";
  const says = options.say.filter(Boolean).map((text) => `<Say voice="${escapeXml(voice)}">${escapeXml(text)}</Say>`).join("");
  const body = options.gather
    ? `<Gather input="speech" action="${escapeXml(options.gather.action)}" method="POST" language="${escapeXml(options.gather.language)}" speechTimeout="auto" timeout="${options.gather.timeoutSeconds ?? 6}">${says}</Gather><Redirect method="POST">${escapeXml(`${options.gather.action}${options.gather.action.includes("?") ? "&" : "?"}silence=1`)}</Redirect>`
    : `${says}${options.hangup ? "<Hangup/>" : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

// ----------------------------------------------------------------------------- Mock

/** Accepts calls without dialling anyone; the demo simulator produces the call's events. */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock";
  readonly isMock = true;
  readonly capabilities = { hostedAgent: true, recording: false, transcription: true };

  async createCall(): Promise<VoiceCallResult> {
    return { providerCallId: `mock_call_${randomUUID()}`, status: "queued" };
  }

  async endCall(): Promise<void> {}

  async getCallStatus(providerCallId: string): Promise<VoiceCallDetails> {
    return { providerCallId, status: "queued" };
  }

  async getRecording(): Promise<{ url: string } | null> {
    return null;
  }

  async getTranscript(): Promise<VoiceTranscript | null> {
    return null;
  }

  handleWebhook(): VoiceWebhookEvent[] {
    throw new IntegrationError("mock", "The mock voice provider has no webhooks", 404, false);
  }
}
