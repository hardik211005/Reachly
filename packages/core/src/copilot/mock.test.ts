import { describe, expect, it } from "vitest";
import "./tools";
import { extractDays, mockCopilotResponder } from "./mock";

const tools = ["get_overview_metrics", "get_ai_spend", "get_usage"];

function ask(text: string) {
  return mockCopilotResponder({ model: "mock-1", agent: "copilot", agentInput: { tools }, messages: [{ role: "user", content: text }] });
}

describe("mock copilot router", () => {
  it("routes AI spend questions to the spend tool", () => {
    const response = ask("How much did we spend on AI this month?");
    expect("toolCalls" in response ? response.toolCalls[0]?.name : null).toBe("get_ai_spend");
  });

  it("parses time windows", () => {
    expect(extractDays("last 14 days")).toBe(14);
    expect(extractDays("this week")).toBe(7);
    expect(extractDays("anything")).toBe(30);
  });

  it("answers from tool results without inventing data", () => {
    const response = mockCopilotResponder({
      model: "mock-1",
      agent: "copilot",
      agentInput: { tools },
      messages: [
        { role: "user", content: "spend on ai" },
        { role: "assistant", content: [{ type: "tool_call", id: "t1", name: "get_ai_spend", input: { days: 30 } }] },
        {
          role: "user",
          content: [{ type: "tool_result", toolCallId: "t1", content: JSON.stringify({ days: 30, totalUsd: 0, totalRequests: 0, byAgent: [] }) }],
        },
      ],
    });
    expect("text" in response ? response.text : "").toContain("No AI requests");
  });

  it("routes pipeline, task and quote questions to the CRM tools", async () => {
    await import("./crm-tools");
    const crmTools = [...tools, "get_pipeline", "get_my_tasks", "list_quotes"];
    const route = (text: string) => {
      const response = mockCopilotResponder({ model: "mock-1", agent: "copilot", agentInput: { tools: crmTools }, messages: [{ role: "user", content: text }] });
      return "toolCalls" in response ? response.toolCalls[0] : null;
    };
    expect(route("How does my pipeline look?")).toMatchObject({ name: "get_pipeline", input: {} });
    expect(route("which deals are in negotiation")).toMatchObject({ name: "get_pipeline", input: { stage: "NEGOTIATION" } });
    expect(route("what's overdue on my tasks?")).toMatchObject({ name: "get_my_tasks", input: { due: "overdue" } });
    expect(route("show accepted quotes")).toMatchObject({ name: "list_quotes", input: { status: "ACCEPTED" } });
  });

  it("explains its capabilities for unrecognised questions", () => {
    const response = ask("tell me a joke");
    expect("text" in response ? response.text : "").toContain("recognise");
  });
});
