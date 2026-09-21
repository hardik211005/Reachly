import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateConditions, interpolate } from "./engine";
import { validateDefinition, workflowInputSchema, type WorkflowDefinition } from "./schemas";
import { WORKFLOW_TEMPLATES } from "./templates";

const data = {
  lead: { name: "Monsoon Café", score: 82, status: "REPLIED", tags: ["hot", "delhi"], city: "New Delhi", email: null },
  event: { type: "reply_classified", properties: { intent: "POSITIVE" }, channel: "EMAIL" },
};

describe("conditions", () => {
  it.each([
    [{ field: "lead.score", op: "gte" as const, value: 80 }, true],
    [{ field: "lead.score", op: "lt" as const, value: 80 }, false],
    [{ field: "event.properties.intent", op: "in" as const, value: ["POSITIVE", "MEETING_REQUEST"] }, true],
    [{ field: "event.properties.intent", op: "not_in" as const, value: ["POSITIVE"] }, false],
    [{ field: "lead.city", op: "contains" as const, value: "delhi" }, true],
    [{ field: "lead.tags", op: "contains" as const, value: "HOT" }, true],
    [{ field: "lead.email", op: "exists" as const, value: null }, false],
    [{ field: "lead.email", op: "not_exists" as const, value: null }, true],
    [{ field: "lead.status", op: "equals" as const, value: "replied" }, true],
    [{ field: "lead.missing", op: "gt" as const, value: 1 }, false],
  ])("%o → %s", (condition, expected) => {
    expect(evaluateCondition(condition, data)).toBe(expected);
  });

  it("combines with all / any", () => {
    const conditions = [
      { field: "lead.score", op: "gte" as const, value: 90 },
      { field: "lead.city", op: "equals" as const, value: "New Delhi" },
    ];
    expect(evaluateConditions(conditions, "all", data)).toBe(false);
    expect(evaluateConditions(conditions, "any", data)).toBe(true);
    expect(evaluateConditions([], "all", data)).toBe(true);
  });
});

describe("templating", () => {
  it("fills known variables and blanks unknown ones", () => {
    expect(interpolate("{{lead.name}} ({{lead.score}}) — {{event.properties.intent}} {{nope.nothing}}!", data)).toBe("Monsoon Café (82) — POSITIVE !");
    expect(interpolate("Tags: {{ lead.tags }}", data)).toBe("Tags: hot, delhi");
  });
});

describe("definition validation", () => {
  it("every template is a valid, activatable workflow", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const definition = workflowInputSchema.parse(template.definition);
      expect(validateDefinition(definition, { n8nAllowed: true }), template.key).toEqual([]);
    }
  });

  it("flags lead steps under triggers without a lead, n8n without the plan, and empty workflows", () => {
    const scheduled = workflowInputSchema.parse({
      name: "Daily",
      trigger: { type: "schedule", frequency: "daily", hour: 9 },
      steps: [
        { id: "a", type: "update_lead_status", status: "INTERESTED" },
        { id: "b", type: "n8n", webhookPath: "digest" },
      ],
    }) as WorkflowDefinition;
    const issues = validateDefinition(scheduled, { n8nAllowed: false });
    expect(issues.map((issue) => issue.stepId)).toEqual(["a", "b"]);
    expect(validateDefinition({ ...scheduled, steps: [] }, { n8nAllowed: true })).toEqual([{ stepId: null, message: "Add at least one step" }]);
  });

  it("rejects malformed steps", () => {
    const result = workflowInputSchema.safeParse({ name: "x y", trigger: { type: "manual" }, steps: [{ id: "a", type: "delay", amount: 0, unit: "days" }] });
    expect(result.success).toBe(false);
  });
});
