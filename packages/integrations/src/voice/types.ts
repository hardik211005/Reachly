import type { WebhookRequest } from "../email/types";

export type VoiceCallStatus = "queued" | "ringing" | "in_progress" | "completed" | "no_answer" | "busy" | "failed" | "canceled";

/** What the AI voice agent should do on the call. Providers without a built-in agent ignore it. */
export interface VoiceAgentConfig {
  /** First sentence the agent says (includes the AI disclosure when required). */
  firstMessage: string;
  /** Full instructions: objective, brief, compliance rules, how to end the call. */
  systemPrompt: string;
  language: string;
  maxDurationSeconds: number;
  /** Phrases that end the call immediately (opt-out handling). */
  endCallPhrases: string[];
  recordingEnabled: boolean;
  voice?: string;
}

export interface VoiceCallRequest {
  to: string;
  from?: string | null;
  agent: VoiceAgentConfig;
  /** Our identifiers, echoed back in webhooks. */
  metadata: { callId: string; organizationId: string };
  /** Public URL for provider status/transcript callbacks. */
  webhookUrl: string;
  /** Twilio: URL that returns the TwiML for the first turn of the conversation. */
  conversationUrl?: string;
}

export interface VoiceCallResult {
  providerCallId: string;
  status: VoiceCallStatus;
}

export interface VoiceCallDetails {
  providerCallId: string;
  status: VoiceCallStatus;
  startedAt?: Date | null;
  answeredAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  endedReason?: string | null;
  costUsd?: number | null;
}

export interface TranscriptSegment {
  speaker: "agent" | "prospect";
  text: string;
  startMs: number;
  endMs: number;
}

export interface VoiceTranscript {
  segments: TranscriptSegment[];
  fullText: string;
  language: string;
}

export type VoiceWebhookEvent =
  | ({ type: "status"; externalEventId: string; providerCallId: string; callId?: string; at: Date } & Omit<VoiceCallDetails, "providerCallId">)
  | { type: "transcript"; externalEventId: string; providerCallId: string; callId?: string; transcript: VoiceTranscript };

export interface VoiceProviderCapabilities {
  /** The provider runs the conversational AI agent itself (Vapi). */
  hostedAgent: boolean;
  recording: boolean;
  transcription: boolean;
}

export interface VoiceProvider {
  readonly name: string;
  readonly isMock: boolean;
  readonly capabilities: VoiceProviderCapabilities;
  createCall(request: VoiceCallRequest): Promise<VoiceCallResult>;
  endCall(providerCallId: string): Promise<void>;
  getCallStatus(providerCallId: string): Promise<VoiceCallDetails>;
  getRecording(providerCallId: string): Promise<{ url: string } | null>;
  getTranscript(providerCallId: string): Promise<VoiceTranscript | null>;
  /** Verifies the signature and parses the delivery; throws `IntegrationError` when invalid. */
  handleWebhook(request: WebhookRequest): VoiceWebhookEvent[];
}

export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `${segment.speaker === "agent" ? "Agent" : "Prospect"}: ${segment.text}`).join("\n");
}
