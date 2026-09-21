import { z } from "zod";
import type { JsonSchema } from "./types";

/**
 * Converts a Zod schema to the strict JSON Schema subset accepted by provider
 * structured-output modes (OpenAI strict mode, Anthropic output_config.format, Gemini):
 *  - every object gets `additionalProperties: false` and lists all properties as required
 *  - validation keywords providers reject are removed (Zod still validates them afterwards)
 */

const STRIPPED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
  "default",
  "examples",
  "uniqueItems",
]);

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (!node || typeof node !== "object") return node;
  const input = node as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (STRIPPED_KEYWORDS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      output.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([prop, schema]) => [prop, normalise(schema)]),
      );
      continue;
    }
    output[key] = normalise(value);
  }
  if (output.type === "object" && output.properties && typeof output.properties === "object") {
    output.additionalProperties = false;
    output.required = Object.keys(output.properties as Record<string, unknown>);
  }
  return output;
}

export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any", io: "output" });
  return normalise(raw) as JsonSchema;
}

/** Extracts the first JSON object/array from model text (tolerates code fences). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model response did not contain valid JSON");
  }
}
