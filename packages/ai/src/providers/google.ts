import { randomUUID } from "node:crypto";
import { extractJson } from "../json-schema";
import {
  AIProviderError,
  isRetryableStatus,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AIStopReason,
} from "../types";

/**
 * Google Gemini `generateContent` over REST. JSON output uses
 * `responseMimeType: application/json` + `responseJsonSchema`; tools use function declarations.
 */

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

function mapFinish(reason: string | undefined, hasToolCalls: boolean): AIStopReason {
  if (hasToolCalls) return "tool_use";
  switch (reason) {
    case "STOP":
      return "end";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "refusal";
    default:
      return "other";
  }
}

export class GoogleProvider implements AIProvider {
  readonly name = "google" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    // Gemini function responses are keyed by function name, so remember call id → name.
    const callNames = new Map<string, string>();
    const contents = request.messages.map((message) => {
      const role = message.role === "assistant" ? "model" : "user";
      if (typeof message.content === "string") return { role, parts: [{ text: message.content }] };
      const parts: GeminiPart[] = message.content.map((part) => {
        if (part.type === "text") return { text: part.text };
        if (part.type === "tool_call") {
          callNames.set(part.id, part.name);
          return { functionCall: { name: part.name, args: (part.input ?? {}) as Record<string, unknown> } };
        }
        return {
          functionResponse: {
            name: callNames.get(part.toolCallId) ?? part.toolCallId,
            response: { content: part.content, isError: part.isError ?? false },
          },
        };
      });
      return { role, parts };
    });

    const generationConfig: Record<string, unknown> = { maxOutputTokens: request.maxTokens ?? 16_000 };
    if (request.jsonSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = request.jsonSchema.schema;
    }

    const body: Record<string, unknown> = { contents, generationConfig };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parameters,
          })),
        },
      ];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 120_000);
    request.signal?.addEventListener("abort", () => controller.abort());
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AIProviderError("google", error instanceof Error ? error.message : String(error), null, true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AIProviderError("google", `HTTP ${response.status} ${detail.slice(0, 300)}`, response.status, isRetryableStatus(response.status));
    }

    const data = (await response.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new AIProviderError("google", `Request blocked: ${data.promptFeedback.blockReason}`, 200, false);
    }
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    const toolCalls = parts
      .filter((part) => part.functionCall)
      .map((part) => ({ id: randomUUID(), name: part.functionCall?.name ?? "", input: part.functionCall?.args ?? {} }));
    const stopReason = mapFinish(candidate?.finishReason, toolCalls.length > 0);
    if (stopReason === "refusal") throw new AIProviderError("google", "The model declined this request", 200, false);

    return {
      text,
      json: request.jsonSchema && text ? extractJson(text) : undefined,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: data.modelVersion ?? request.model,
      provider: "google",
    };
  }
}
