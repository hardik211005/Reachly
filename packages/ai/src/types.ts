import type { AIProviderName } from "@repo/config";

/**
 * Provider-agnostic LLM contract. Every adapter (OpenAI, Anthropic, Google, Mock)
 * translates to and from these shapes so agents never depend on a vendor SDK.
 */

export type JsonSchema = Record<string, unknown>;

export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentPart[];
}

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type AIEffort = "low" | "medium" | "high";

export interface AIGenerateRequest {
  model: string;
  system?: string;
  messages: AIMessage[];
  maxTokens?: number;
  /** Constrain the response to JSON matching this (strict) schema. */
  jsonSchema?: { name: string; schema: JsonSchema };
  tools?: AIToolDefinition[];
  /** Reasoning effort hint; mapped to provider-specific controls where supported. */
  effort?: AIEffort;
  /** Which agent is calling — used for logging and by the mock provider's responders. */
  agent: string;
  /** Original structured input, available to deterministic mock responders. */
  agentInput?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type AIStopReason = "end" | "max_tokens" | "tool_use" | "refusal" | "other";

export interface AIToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AIGenerateResult {
  text: string;
  /** Parsed JSON when jsonSchema was requested (not yet validated against the Zod schema). */
  json?: unknown;
  toolCalls: AIToolCall[];
  stopReason: AIStopReason;
  usage: { inputTokens: number; outputTokens: number };
  /** Model that actually served the request (may differ when a provider-side fallback ran). */
  model: string;
  provider: AIProviderName;
}

export interface AIProvider {
  readonly name: AIProviderName;
  generate(request: AIGenerateRequest): Promise<AIGenerateResult>;
}

export class AIProviderError extends Error {
  override name = "AIProviderError";
  constructor(
    public readonly provider: AIProviderName,
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** HTTP statuses worth retrying (rate limits, overload, transient server errors). */
export function isRetryableStatus(status: number | null | undefined): boolean {
  return status === null || status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function textOf(content: AIMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : part.type === "tool_result" ? part.content : ""))
    .filter(Boolean)
    .join("\n");
}

/** Rough token estimate (≈4 chars/token) used by the mock provider and pre-flight estimates. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
