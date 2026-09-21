import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, toStrictJsonSchema } from "./json-schema";

describe("toStrictJsonSchema", () => {
  it("closes objects and requires every property", () => {
    const schema = toStrictJsonSchema(
      z.object({
        name: z.string().min(2),
        tags: z.array(z.object({ key: z.string(), weight: z.number().max(1) })),
        note: z.string().nullable(),
      }),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["name", "tags", "note"]);
    const properties = schema.properties as Record<string, { items: Record<string, unknown> }>;
    expect(properties.tags?.items.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toContain("minLength");
    expect(JSON.stringify(schema)).not.toContain("maximum");
  });
});

describe("extractJson", () => {
  it("parses fenced and embedded JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => extractJson("no json here")).toThrow();
  });
});
