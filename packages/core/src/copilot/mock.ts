import { randomUUID } from "node:crypto";
import { textOf, type AIContentPart, type AIGenerateRequest } from "@repo/ai";
import type { MockResponse } from "@repo/ai";

/**
 * Deterministic copilot for demo mode. It routes the question to real tools with simple
 * intent rules and phrases the tool results — so even the mock copilot only reports
 * actual workspace data. Modules add intents/formatters as they register tools.
 */

type IntentRule = { tool: string; match: (text: string) => Record<string, unknown> | null };
type Formatter = (result: unknown, args: unknown) => string;

const intents: IntentRule[] = [];
const formatters = new Map<string, Formatter>();

/** `first` puts specific intents ahead of the broad metrics intent. */
export function registerMockIntent(rule: IntentRule, options: { first?: boolean } = {}): void {
  if (options.first) intents.unshift(rule);
  else intents.push(rule);
}

export function registerMockFormatter(tool: string, formatter: Formatter): void {
  formatters.set(tool, formatter);
}

export function extractDays(text: string, fallback = 30): number {
  const lower = text.toLowerCase();
  const explicit = /(\d{1,3})\s*(day|days|d)\b/.exec(lower);
  if (explicit?.[1]) return Math.min(365, Number(explicit[1]));
  if (/\btoday\b/.test(lower)) return 1;
  if (/\b(this|last|past) week\b/.test(lower)) return 7;
  if (/\b(this|last|past) month\b/.test(lower)) return 30;
  if (/\b(this|last|past) quarter\b/.test(lower)) return 90;
  if (/\b(this|last|past) year\b/.test(lower)) return 365;
  return fallback;
}

const pct = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%` : "n/a");
const usd = (value: number) => `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;

registerMockIntent({
  tool: "get_ai_spend",
  match: (text) => (/\b(spend|spent|cost|costs|bill)\b/.test(text) && /\b(ai|model|llm|tokens?|credits?)\b/.test(text) ? { days: extractDays(text) } : null),
});
registerMockIntent({
  tool: "get_usage",
  match: (text) => (/\b(usage|limit|limits|quota|credits left|remaining)\b/.test(text) ? {} : null),
});
registerMockIntent({
  tool: "get_overview_metrics",
  match: (text) =>
    /\b(how are we doing|metrics|overview|performance|stats|summary|reply rate|replies|revenue|meetings|conversion)\b/.test(text)
      ? { days: extractDays(text) }
      : null,
});

registerMockFormatter("get_ai_spend", (result) => {
  const data = result as { days: number; totalUsd: number; totalRequests: number; byAgent: Array<{ agent: string; requests: number; usd: number }> };
  if (!data.totalRequests) return `No AI requests were made in the last ${data.days} days.`;
  const top = data.byAgent
    .slice(0, 4)
    .map((row) => `• ${row.agent.replace(/_/g, " ")}: ${usd(row.usd)} across ${row.requests} request${row.requests === 1 ? "" : "s"}`)
    .join("\n");
  return `AI spend over the last ${data.days} days: ${usd(data.totalUsd)} across ${data.totalRequests} requests.\n${top}`;
});

registerMockFormatter("get_usage", (result) => {
  const data = result as { metrics: Array<{ metric: string; used: number; limit: number | null }> };
  return `Usage this billing period:\n${data.metrics
    .map((metric) => `• ${metric.metric}: ${metric.used.toLocaleString()}${metric.limit === null ? " (unlimited)" : ` of ${metric.limit.toLocaleString()}`}`)
    .join("\n")}`;
});

registerMockFormatter("get_overview_metrics", (result) => {
  const data = result as { days: number; kpis: Array<{ metric: string; value: number; change: number | null; format: string }> };
  const pick = ["New leads", "Qualified leads", "Outreach sent", "Replies", "Positive replies", "Meetings", "Deals won", "Revenue won"];
  const lines = data.kpis
    .filter((kpi) => pick.includes(kpi.metric))
    .map((kpi) => `• ${kpi.metric}: ${kpi.format === "percent" ? `${(kpi.value * 100).toFixed(1)}%` : kpi.value.toLocaleString()} (${pct(kpi.change)} vs previous period)`);
  return `Here's the last ${data.days} days:\n${lines.join("\n")}`;
});

function lastUserText(request: AIGenerateRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

function pendingToolResults(request: AIGenerateRequest): Array<{ name: string; args: unknown; content: string; isError: boolean }> | null {
  const last = request.messages.at(-1);
  if (!last || typeof last.content === "string") return null;
  const results = last.content.filter((part): part is Extract<AIContentPart, { type: "tool_result" }> => part.type === "tool_result");
  if (!results.length) return null;
  const previous = request.messages.at(-2);
  const calls = previous && typeof previous.content !== "string" ? previous.content : [];
  return results.map((result) => {
    const call = calls.find((part): part is Extract<AIContentPart, { type: "tool_call" }> => part.type === "tool_call" && part.id === result.toolCallId);
    return { name: call?.name ?? "unknown", args: call?.input, content: result.content, isError: Boolean(result.isError) };
  });
}

export function mockCopilotResponder(request: AIGenerateRequest): MockResponse {
  const available = new Set(((request.agentInput as { tools?: string[] } | undefined)?.tools ?? []) as string[]);
  const results = pendingToolResults(request);

  if (results) {
    const text = results
      .map((result) => {
        if (result.isError) return `I couldn't complete that: ${JSON.parse(result.content).error as string}`;
        const formatter = formatters.get(result.name);
        const payload = JSON.parse(result.content) as unknown;
        return formatter ? formatter(payload, result.args) : `Result from ${result.name}: ${result.content.slice(0, 400)}`;
      })
      .join("\n\n");
    return { text };
  }

  const question = lastUserText(request).toLowerCase();
  const rule = intents.find((intent) => available.has(intent.tool) && intent.match(question) !== null);
  if (rule) {
    return { toolCalls: [{ id: randomUUID(), name: rule.tool, input: rule.match(question) ?? {} }] };
  }

  const capabilities = [...available].map((name) => `• ${name.replace(/_/g, " ")}`).join("\n");
  const asked = textOf(request.messages.at(-1)?.content ?? "").trim().length > 0;
  return {
    text: `${asked ? "I didn't recognise that question. " : ""}In demo mode I answer from your workspace data using these tools:\n${capabilities}\n\nTry "How much did we spend on AI this month?" or "How are we doing this week?"`,
  };
}
