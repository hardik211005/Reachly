import type { AIEffort } from "@repo/ai";
import type { z } from "zod";

/**
 * An agent is a single, narrowly-scoped AI responsibility: a versioned prompt, a Zod
 * output contract and a deterministic mock used in demo mode. Agents never touch the
 * database — services gather context, run the agent, and persist results.
 */
export interface AgentDefinition<I, O> {
  name: string;
  /** Bump when the prompt or schema changes; part of the cache key and stored on AIRequest. */
  version: string;
  description: string;
  output: z.ZodType<O>;
  effort?: AIEffort;
  maxTokens?: number;
  /** Identical inputs can reuse a cached response. */
  cacheable: boolean;
  buildPrompt(input: I): { system: string; user: string };
  /** Deterministic, input-grounded output used by the mock provider. */
  mock(input: I): O;
}

export function defineAgent<I, O>(definition: AgentDefinition<I, O>): AgentDefinition<I, O> {
  return definition;
}
