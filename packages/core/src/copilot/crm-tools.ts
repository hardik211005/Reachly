import { DEAL_STAGE_LABELS, DEAL_STAGES, QUOTE_STATUS_LABELS, type DealStage, type QuoteStatus } from "@repo/config";
import { z } from "zod";
import { listPipeline } from "../crm/deals";
import { listTasks } from "../crm/tasks";
import { formatMoney } from "../quotes/pricing";
import { listQuotes } from "../quotes/service";
import { registerMockFormatter, registerMockIntent } from "./mock";
import { registerCopilotTool } from "./tools";

/** Copilot tools over the pipeline, tasks and quotes — thin wrappers over the CRM services. */

registerCopilotTool({
  name: "get_pipeline",
  description: "The sales pipeline: open value, weighted forecast, won this month, win rate, deals and value per stage, and the biggest open deals. Optionally only one stage.",
  parameters: z.object({ stage: z.enum(DEAL_STAGES).optional(), limit: z.number().int().min(1).max(20).default(6) }),
  permission: "crm:read",
  async run(ctx, args) {
    const pipeline = await listPipeline(ctx);
    const currency = pipeline.deals[0]?.currency ?? "INR";
    const open = pipeline.deals.filter((deal) => (args.stage ? deal.stage === args.stage : deal.stage !== "WON" && deal.stage !== "LOST"));
    return {
      currency,
      summary: pipeline.summary,
      stages: pipeline.stages.filter((stage) => stage.count > 0),
      deals: [...open]
        .sort((a, b) => b.value - a.value)
        .slice(0, args.limit)
        .map((deal) => ({ company: deal.lead.name, title: deal.title, stage: deal.stage, value: deal.value, probability: deal.probability, nextStep: deal.nextTask?.title ?? null, nextStepDue: deal.nextTask?.dueAt ?? null, quote: deal.quote ? `${deal.quote.number} (${deal.quote.status.toLowerCase()})` : null })),
    };
  },
});

registerCopilotTool({
  name: "get_my_tasks",
  description: "The current user's open tasks, overdue and due soon first, with the company each belongs to.",
  parameters: z.object({ due: z.enum(["overdue", "today", "week", "any"]).default("week") }),
  permission: "crm:read",
  async run(ctx, args) {
    const tasks = await listTasks(ctx, { assignee: "me", status: "OPEN", due: args.due });
    const now = Date.now();
    return {
      due: args.due,
      tasks: tasks.slice(0, 15).map((task) => ({ title: task.title, company: task.lead?.name ?? null, dueAt: task.dueAt, overdue: Boolean(task.dueAt && task.dueAt.getTime() < now), priority: task.priority })),
    };
  },
});

registerCopilotTool({
  name: "list_quotes",
  description: "Quotes with number, company, total and status (draft, sent, accepted, declined, expired), newest first. Optionally one status.",
  parameters: z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]).optional() }),
  permission: "crm:read",
  async run(ctx, args) {
    const result = await listQuotes(ctx, { status: args.status, limit: 12 });
    return {
      counts: result.counts,
      quotes: result.quotes.map((quote) => ({ number: quote.number, company: quote.lead.name, total: quote.total, currency: quote.currency, status: quote.status, viewed: Boolean(quote.viewedAt), sentAt: quote.sentAt, validUntil: quote.validUntil })),
    };
  },
});

// ----------------------------------------------------------------------------- Demo-mode intents

registerMockIntent(
  {
    tool: "get_pipeline",
    match: (text) => {
      if (!/\b(pipeline|deals?|forecast|win rate|revenue|closing|close this month)\b/.test(text)) return null;
      const stage = DEAL_STAGES.find((item) => new RegExp(`\\b${DEAL_STAGE_LABELS[item].toLowerCase()}\\b`).test(text));
      return stage && stage !== "NEW" ? { stage } : {};
    },
  },
  { first: true },
);
registerMockIntent({ tool: "get_my_tasks", match: (text) => (/\b(tasks?|to-?dos?|follow[- ]?ups?|what should i do|my day)\b/.test(text) ? { due: /\boverdue\b/.test(text) ? "overdue" : /\btoday\b/.test(text) ? "today" : "week" } : null) }, { first: true });
registerMockIntent(
  {
    tool: "list_quotes",
    match: (text) => {
      if (!/\b(quotes?|quotations?|proposals?)\b/.test(text)) return null;
      const status = /\b(accepted|won)\b/.test(text) ? "ACCEPTED" : /\b(declined|rejected)\b/.test(text) ? "REJECTED" : /\b(expired)\b/.test(text) ? "EXPIRED" : /\b(drafts?)\b/.test(text) ? "DRAFT" : /\b(sent|open|pending|waiting)\b/.test(text) ? "SENT" : undefined;
      return status ? { status } : {};
    },
  },
  { first: true },
);

registerMockFormatter("get_pipeline", (result) => {
  const data = result as {
    currency: string;
    summary: { openCount: number; openValue: number; weightedValue: number; wonThisMonth: { count: number; value: number }; winRate: number | null };
    stages: Array<{ stage: DealStage; count: number; value: number }>;
    deals: Array<{ company: string; stage: DealStage; value: number; nextStep: string | null }>;
  };
  const money = (value: number) => formatMoney(value, data.currency, { decimals: false });
  if (!data.summary.openCount && !data.summary.wonThisMonth.count) return "The pipeline is empty. Deals appear when leads get interested, book meetings or receive quotes — or add one from CRM → New deal.";
  const stages = data.stages.filter((stage) => stage.stage !== "WON" && stage.stage !== "LOST").map((stage) => `${DEAL_STAGE_LABELS[stage.stage]} ${stage.count}`).join(", ");
  const top = data.deals.slice(0, 3).map((deal) => `${deal.company} (${money(deal.value)}, ${DEAL_STAGE_LABELS[deal.stage].toLowerCase()}${deal.nextStep ? ` — next: ${deal.nextStep.toLowerCase()}` : ""})`).join("; ");
  return `${data.summary.openCount} open deals worth ${money(data.summary.openValue)} (${money(data.summary.weightedValue)} weighted). Won this month: ${data.summary.wonThisMonth.count} for ${money(data.summary.wonThisMonth.value)}${data.summary.winRate !== null ? `, win rate ${Math.round(data.summary.winRate * 100)}% over 90 days` : ""}.${stages ? ` By stage: ${stages}.` : ""}${top ? ` Biggest: ${top}.` : ""}`;
});

registerMockFormatter("get_my_tasks", (result) => {
  const data = result as { due: string; tasks: Array<{ title: string; company: string | null; overdue: boolean }> };
  if (!data.tasks.length) return data.due === "overdue" ? "Nothing overdue — nice." : "No open tasks due. You're all caught up.";
  const overdue = data.tasks.filter((task) => task.overdue).length;
  return `You have ${data.tasks.length} open task${data.tasks.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : ""}:\n${data.tasks
    .slice(0, 8)
    .map((task) => `• ${task.title}${task.company ? ` — ${task.company}` : ""}${task.overdue ? " (overdue)" : ""}`)
    .join("\n")}`;
});

registerMockFormatter("list_quotes", (result) => {
  const data = result as { quotes: Array<{ number: string; company: string; total: number; currency: string; status: QuoteStatus; viewed: boolean }> };
  if (!data.quotes.length) return "No quotes match. Draft one from a deal — AI picks items from the conversation and prices come from your catalog.";
  return `${data.quotes.length} quote${data.quotes.length === 1 ? "" : "s"}:\n${data.quotes
    .slice(0, 8)
    .map((quote) => `• ${quote.number} — ${quote.company}, ${formatMoney(quote.total, quote.currency, { decimals: false })}, ${quote.status === "SENT" && quote.viewed ? "viewed" : QUOTE_STATUS_LABELS[quote.status].toLowerCase()}`)
    .join("\n")}`;
});
