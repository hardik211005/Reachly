import { extractJson } from "../json-schema";
import {
  AIProviderError,
  isRetryableStatus,
  type AIContentPart,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AIStopReason,
} from "../types";

/**
 * OpenAI Chat Completions over its stable REST endpoint. JSON output uses
 * `response_format: { type: "json_schema", strict: true }`; tools use function calling.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  model: string;
  choices: Array<{
    finish_reason: string | null;
    message: {
      content: string | null;
      refusal?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function toChatMessages(request: AIGenerateRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  for (const message of request.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    const parts: AIContentPart[] = message.content;
    const text = parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n");
    const calls = parts.filter((p): p is Extract<AIContentPart, { type: "tool_call" }> => p.type === "tool_call");
    const results = parts.filter((p): p is Extract<AIContentPart, { type: "tool_result" }> => p.type === "tool_result");
    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.length
          ? calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
            }))
          : undefined,
      });
    } else {
      for (const result of results) {
        messages.push({ role: "tool", tool_call_id: result.toolCallId, content: result.content });
      }
      if (text) messages.push({ role: "user", content: text });
    }
  }
  return messages;
}

function mapFinish(reason: string | null): AIStopReason {
  switch (reason) {
    case "stop":
      return "end";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toChatMessages(request),
      max_completion_tokens: request.maxTokens ?? 16_000,
    };
    if (request.effort) body.reasoning_effort = request.effort;
    if (request.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: true },
      };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 120_000);
    request.signal?.addEventListener("abort", () => controller.abort());
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AIProviderError("openai", error instanceof Error ? error.message : String(error), null, true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AIProviderError("openai", `HTTP ${response.status} ${detail.slice(0, 300)}`, response.status, isRetryableStatus(response.status));
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices[0];
    if (!choice) throw new AIProviderError("openai", "Empty response", response.status, true);
    if (choice.message.refusal) throw new AIProviderError("openai", "The model declined this request", 200, false);

    const text = choice.message.content ?? "";
    return {
      text,
      json: request.jsonSchema && text ? extractJson(text) : undefined,
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        input: safeParse(call.function.arguments),
      })),
      stopReason: mapFinish(choice.finish_reason),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      model: data.model,
      provider: "openai",
    };
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
