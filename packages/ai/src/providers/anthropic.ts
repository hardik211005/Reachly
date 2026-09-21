import Anthropic from "@anthropic-ai/sdk";
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

/** Models that accept Anthropic's server-side refusal fallback (`fallbacks: "default"`). */
function supportsServerFallback(model: string): boolean {
  return model === "claude-opus-5" || model.startsWith("claude-fable-");
}

function toAnthropicContent(content: string | AIContentPart[]): Anthropic.Beta.BetaContentBlockParam[] | string {
  if (typeof content === "string") return content;
  return content.map((part): Anthropic.Beta.BetaContentBlockParam => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };
      case "tool_call":
        return { type: "tool_use", id: part.id, name: part.name, input: part.input };
      case "tool_result":
        return { type: "tool_result", tool_use_id: part.toolCallId, content: part.content, is_error: part.isError };
    }
  });
}

function mapStopReason(reason: string | null): AIStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * Anthropic Messages API via the official SDK. Uses structured outputs
 * (`output_config.format`) for JSON and opts into server-side refusal fallbacks on
 * models that support them. Retries/fallbacks across models are handled by the caller
 * (AIService), so SDK retries are disabled to avoid multiplying attempts.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 120_000 });
  }

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const serverFallback = supportsServerFallback(request.model);
    const outputConfig: Anthropic.Beta.BetaOutputConfig = {};
    if (request.effort) outputConfig.effort = request.effort;
    if (request.jsonSchema) outputConfig.format = { type: "json_schema", schema: request.jsonSchema.schema };

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 16_000,
          system: request.system,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: toAnthropicContent(message.content),
          })),
          tools: request.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
          })),
          output_config: Object.keys(outputConfig).length > 0 ? outputConfig : undefined,
          ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: request.signal, timeout: request.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new AIProviderError("anthropic", error.message, error.status ?? null, isRetryableStatus(error.status));
      }
      throw new AIProviderError("anthropic", error instanceof Error ? error.message : String(error), null, true);
    }

    const stopReason = mapStopReason(response.stop_reason);
    if (stopReason === "refusal") {
      throw new AIProviderError("anthropic", "The model declined this request", 200, false);
    }

    let text = "";
    const toolCalls: AIGenerateResult["toolCalls"] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }

    return {
      text,
      json: request.jsonSchema && text ? extractJson(text) : undefined,
      toolCalls,
      stopReason,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      model: response.model,
      provider: "anthropic",
    };
  }
}
