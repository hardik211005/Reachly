import { z } from "zod";
import { getOverview } from "../analytics/overview";
import { getUsage } from "../billing/usage";
import { can, type TenantContext } from "../context";
import type { Permission } from "../rbac";

/**
 * Copilot tools. Each tool is a thin, permission-checked wrapper over a real service —
 * the copilot can only report what these return, so it cannot invent workspace data.
 * Modules register additional tools with `registerCopilotTool`.
 */
export interface CopilotTool<A = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  permission: Permission;
  run(ctx: TenantContext, args: A): Promise<unknown>;
}

const registry = new Map<string, CopilotTool>();

export function registerCopilotTool<A>(tool: CopilotTool<A>): void {
  registry.set(tool.name, tool as CopilotTool);
}

export function listCopilotTools(ctx: TenantContext): CopilotTool[] {
  return [...registry.values()].filter((tool) => can(ctx, tool.permission));
}

export function getCopilotTool(name: string): CopilotTool | undefined {
  return registry.get(name);
}

async function timezoneOf(ctx: TenantContext): Promise<string> {
  const org = await ctx.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
  return org?.timezone ?? "UTC";
}

registerCopilotTool({
  name: "get_overview_metrics",
  description:
    "Key outreach metrics for the last N days with comparison to the previous period: new leads, qualified leads, outreach sent, replies, positive replies, meetings, deals won, revenue, conversion rate, AI cost.",
  parameters: z.object({ days: z.number().int().min(1).max(365).default(30) }),
  permission: "analytics:read",
  async run(ctx, args) {
    const overview = await getOverview(ctx, { days: args.days }, await timezoneOf(ctx));
    return {
      days: args.days,
      kpis: overview.kpis.map((kpi) => ({ metric: kpi.label, value: kpi.value, previous: kpi.previous, change: kpi.delta, format: kpi.format })),
      channels: overview.channels,
    };
  },
});

registerCopilotTool({
  name: "get_ai_spend",
  description: "AI usage and cost for the last N days, broken down by agent (qualification, outreach, etc.).",
  parameters: z.object({ days: z.number().int().min(1).max(365).default(30) }),
  permission: "analytics:read",
  async run(ctx, args) {
    const since = new Date(Date.now() - args.days * 86_400_000);
    const byAgent = await ctx.db.aIRequest.groupBy({
      by: ["agent"],
      where: { createdAt: { gte: since } },
      _sum: { costMicroUsd: true, credits: true, inputTokens: true, outputTokens: true },
      _count: { _all: true },
    });
    const totalMicroUsd = byAgent.reduce((sum, row) => sum + (row._sum.costMicroUsd ?? 0), 0);
    return {
      days: args.days,
      totalUsd: totalMicroUsd / 1_000_000,
      totalRequests: byAgent.reduce((sum, row) => sum + row._count._all, 0),
      byAgent: byAgent
        .map((row) => ({
          agent: row.agent,
          requests: row._count._all,
          usd: (row._sum.costMicroUsd ?? 0) / 1_000_000,
          credits: row._sum.credits ?? 0,
          tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
        }))
        .sort((a, b) => b.usd - a.usd || b.requests - a.requests),
    };
  },
});

registerCopilotTool({
  name: "get_usage",
  description: "Current billing-period usage against plan limits (lead credits, AI credits, emails, WhatsApp, voice minutes, workflow runs).",
  parameters: z.object({}),
  permission: "workspace:read",
  async run(ctx) {
    const usage = await getUsage(ctx);
    return {
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      metrics: usage.metrics.map((metric) => ({ metric: metric.label, used: metric.used, limit: metric.limit, remaining: metric.remaining })),
    };
  },
});
