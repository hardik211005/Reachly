import {
  estimateTokens,
  textOf,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AIToolCall,
} from "../types";

/**
 * Deterministic local provider for demo mode and tests. No network, no cost.
 *
 * Agents register a responder that derives a plausible, input-grounded output from the
 * agent's structured input (e.g. an ICP built from the business profile fields). Output
 * is labelled as mock by the provider name ("mock") everywhere it is displayed.
 */

export type MockResponse =
  | { json: unknown; text?: string }
  | { text: string }
  | { toolCalls: AIToolCall[]; text?: string };

export type MockResponder = (request: AIGenerateRequest) => MockResponse | Promise<MockResponse>;

export class MockAIProvider implements AIProvider {
  readonly name = "mock" as const;
  private readonly responders = new Map<string, MockResponder>();

  register(agent: string, responder: MockResponder): this {
    this.responders.set(agent, responder);
    return this;
  }

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const responder = this.responders.get(request.agent);
    const response: MockResponse = responder
      ? await responder(request)
      : { text: `Mock response for ${request.agent}.` };

    const text = "json" in response ? (response.text ?? JSON.stringify(response.json)) : (response.text ?? "");
    const toolCalls = "toolCalls" in response ? response.toolCalls : [];
    const promptText = [request.system ?? "", ...request.messages.map((message) => textOf(message.content))].join("\n");

    return {
      text,
      json: "json" in response ? response.json : undefined,
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : "end",
      usage: { inputTokens: estimateTokens(promptText), outputTokens: estimateTokens(text) },
      model: request.model,
      provider: "mock",
    };
  }
}
