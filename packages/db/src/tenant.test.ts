import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TENANT_MODELS } from "./tenant";

function modelsWithRequiredOrganizationId(schema: string): string[] {
  const models: string[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  for (const match of schema.matchAll(modelRegex)) {
    const [, name, body] = match;
    if (name && body && /^\s*organizationId\s+String\s/m.test(body)) models.push(name);
  }
  return models;
}

describe("TENANT_MODELS", () => {
  it("covers every model with a required organizationId column", () => {
    const schema = readFileSync(resolve(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
    const expected = modelsWithRequiredOrganizationId(schema).sort();
    expect([...TENANT_MODELS].sort()).toEqual(expected);
  });
});
