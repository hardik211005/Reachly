import { randomUUID } from "node:crypto";
import { toStrictJsonSchema, type AIContentPart, type AIGenerateRequest, type AIMessage } from "@repo/ai";
import { brand } from "@repo/config";
import { z } from "zod";
import { generateWithTools, getMockProvider } from "../ai/service";
import type { TenantContext } from "../context";
import { ForbiddenError, ValidationError } from "../errors";
import { logger } from "../logger";
import { mockCopilotResponder } from "./mock";
import { getCopilotTool, listCopilotTools } from "./tools";
import "./outreach-tools";

export const copilotRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(30),
});
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

export interface CopilotToolTrace {
  name: string;
  args: unknown;
  ok: boolean;
  error?: string;
}

export interface CopilotResponse {
  answer: string;
  tools: CopilotToolTrace[];
  provider: string;
  model: string;
}

const MAX_TOOL_ROUNDS = 5;
const VERSION = "copilot-v1";

// The mock provider answers copilot turns with a deterministic router over the same tools.
getMockProvider().register("copilot", (request: AIGenerateRequest) => mockCopilotResponder(request));

function systemPrompt(): string {
  return [
    `You are the in-app copilot for ${brand.name}, a B2B lead discovery and outreach platform.`,
    "You answer questions about the user's workspace ONLY by calling the provided tools and reporting their results.",
    "Never invent numbers, leads, campaigns or events. If no tool can answer, say what you can't do and suggest where in the app to look.",
    "When a tool creates or changes something (e.g. a draft campaign), say exactly what was created and link the user to review it.",
    "Be concise: short paragraphs or bullet points, numbers formatted for humans, dates relative when helpful.",
  ].join("\n");
}

/**
 * Runs the copilot's tool loop: model proposes tool calls → tools execute against real
 * services (tenant-scoped, permission-checked, schema-validated) → results go back to the
 * model → repeat until it answers.
 */
export async function askCopilot(ctx: TenantContext, request: CopilotRequest): Promise<CopilotResponse> {
  const parsed = copilotRequestSchema.parse(request);
  const tools = listCopilotTools(ctx);
  const toolDefinitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toStrictJsonSchema(tool.parameters),
  }));
  const messages: AIMessage[] = parsed.messages.map((message) => ({ role: message.role, content: message.content }));
  const traces: CopilotToolTrace[] = [];
  let provider = "mock";
  let model = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const { result, meta } = await generateWithTools(ctx, {
      agent: "copilot",
      version: VERSION,
      system: systemPrompt(),
      messages,
      tools: toolDefinitions,
      agentInput: { tools: tools.map((tool) => tool.name) },
    });
    provider = meta.provider;
    model = meta.model;

    if (result.stopReason !== "tool_use" || result.toolCalls.length === 0) {
      return { answer: result.text.trim() || "I couldn't find an answer to that.", tools: traces, provider, model };
    }

    const assistantParts: AIContentPart[] = [];
    if (result.text) assistantParts.push({ type: "text", text: result.text });
    const resultParts: AIContentPart[] = [];

    // Execute the round's tool calls concurrently; every call gets a result (errors included).
    const executions = await Promise.all(
      result.toolCalls.map(async (call) => {
        const id = call.id || randomUUID();
        assistantParts.push({ type: "tool_call", id, name: call.name, input: call.input });
        const tool = getCopilotTool(call.name);
        try {
          if (!tool || !tools.includes(tool)) throw new ForbiddenError(`Tool ${call.name} is not available`);
          const args = tool.parameters.safeParse(call.input ?? {});
          if (!args.success) throw new ValidationError(`Invalid arguments: ${args.error.message.slice(0, 300)}`);
          const output = await tool.run(ctx, args.data);
          traces.push({ name: call.name, args: args.data, ok: true });
          return { type: "tool_result" as const, toolCallId: id, content: JSON.stringify(output) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ err: error, tool: call.name }, "copilot tool failed");
          traces.push({ name: call.name, args: call.input, ok: false, error: message });
          return { type: "tool_result" as const, toolCallId: id, content: JSON.stringify({ error: message }), isError: true };
        }
      }),
    );
    resultParts.push(...executions);
    messages.push({ role: "assistant", content: assistantParts });
    messages.push({ role: "user", content: resultParts });
  }

  return {
    answer: "That needed more steps than I'm allowed to take in one go. Try a narrower question.",
    tools: traces,
    provider,
    model,
  };
}
