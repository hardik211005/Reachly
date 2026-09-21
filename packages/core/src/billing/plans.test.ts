import { describe, expect, it } from "vitest";
import { PLAN_DEFINITIONS, aiCreditsForCost, planDefinitionSchema, type UsageMetric } from "@repo/config";

describe("plan configuration", () => {
  it("every plan definition validates", () => {
    for (const plan of PLAN_DEFINITIONS) expect(() => planDefinitionSchema.parse(plan)).not.toThrow();
  });

  it("higher tiers never have lower limits", () => {
    const [free, pro, scale] = PLAN_DEFINITIONS;
    if (!free || !pro || !scale) throw new Error("expected three plans");
    for (const metric of Object.keys(free.limits.usage) as UsageMetric[]) {
      const limits = [free.limits.usage[metric], pro.limits.usage[metric], scale.limits.usage[metric]];
      for (let index = 1; index < limits.length; index += 1) {
        const lower = limits[index - 1];
        const higher = limits[index];
        if (lower !== null && lower !== undefined && higher !== null && higher !== undefined) {
          expect(higher).toBeGreaterThanOrEqual(lower);
        }
      }
    }
  });

  it("charges at least one AI credit per request", () => {
    expect(aiCreditsForCost(0)).toBe(1);
    expect(aiCreditsForCost(1500)).toBe(2);
  });
});
