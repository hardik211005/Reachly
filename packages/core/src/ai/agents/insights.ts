import { z } from "zod";
import { defineAgent } from "../agent";

/**
 * insight_writer — rephrases a computed insight for a business owner. The statistics are done
 * in code; this agent may only reword them. Outputs that introduce any number not present in
 * the facts are rejected by the caller (see `usesOnlyKnownNumbers`).
 */

export const insightWriterSchema = z.object({
  title: z.string().describe("At most 70 characters. States the finding, no numbers required."),
  body: z.string().describe("One or two sentences with the supporting numbers, then one practical suggestion."),
});
export type InsightWriting = z.infer<typeof insightWriterSchema>;

export interface InsightWriterInput {
  business: string;
  kind: string;
  facts: Record<string, string | number>;
  draft: { title: string; body: string };
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

function normalise(value: string): string {
  return value.replace(/,/g, "").replace(/\.0+$/, "");
}

/** True when every number in the text also appears in the facts or the draft. */
export function usesOnlyKnownNumbers(text: string, input: InsightWriterInput): boolean {
  const allowed = new Set<string>();
  for (const source of [...Object.values(input.facts).map(String), input.draft.title, input.draft.body]) {
    for (const match of source.match(NUMBER) ?? []) allowed.add(normalise(match));
  }
  return (text.match(NUMBER) ?? []).every((match) => allowed.has(normalise(match)));
}

export const insightWriterAgent = defineAgent<InsightWriterInput, InsightWriting>({
  name: "insight_writer",
  version: "v1",
  description: "Rewords a statistically computed analytics insight in plain language, using only the supplied numbers.",
  output: insightWriterSchema,
  effort: "low",
  maxTokens: 600,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        `You write short analytics insights for the owner of ${input.business}, a small business using an outreach platform.`,
        "Rewrite the draft so it is clear, specific and useful. Rules:",
        "- Use only the numbers in the facts and the draft. Do not add, round differently, or compute new numbers.",
        "- Do not claim causes the data doesn't show; describe what happened and suggest one sensible action.",
        "- Title: at most 70 characters. Body: one or two sentences plus one suggestion. Plain, friendly, no hype, no emojis.",
      ].join("\n"),
      user: JSON.stringify({ kind: input.kind, facts: input.facts, draft: input.draft }, null, 2),
    };
  },
  mock: (input) => input.draft,
});
