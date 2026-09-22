import type { Prisma } from "@repo/db";
import { z } from "zod";
import { insightWriterAgent, usesOnlyKnownNumbers, type InsightWriterInput } from "../ai/agents/insights";
import { runAgent } from "../ai/service";
import { resolveFilters } from "../analytics/filters";
import { resolvePlan } from "../billing/plans";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { logger } from "../logger";
import { runGenerators, type Candidate } from "./generators";

/**
 * AI insights. Generators compute every number from the event log with sample sizes and a
 * confidence; AI (when available) only rewords the result and is checked for invented
 * numbers. Each run replaces the current set; older runs stay as history.
 */

const MAX_INSIGHTS = 8;
const PERIOD_DAYS = 30;

function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function phrase(ctx: TenantContext, candidate: Candidate, business: string): Promise<{ title: string; body: string; phrasedByAI: boolean }> {
  const input: InsightWriterInput = { business, kind: candidate.kind, facts: candidate.facts, draft: { title: candidate.title, body: candidate.body } };
  try {
    const { output, meta } = await runAgent(ctx, insightWriterAgent, input);
    const title = output.title.trim().slice(0, 120);
    const body = output.body.trim().slice(0, 600);
    // Reject any wording that brings in a number the analysis didn't produce.
    if (!title || !body || !usesOnlyKnownNumbers(`${title} ${body}`, input)) return { title: candidate.title, body: candidate.body, phrasedByAI: false };
    return { title, body, phrasedByAI: meta.provider !== "mock" && (title !== candidate.title || body !== candidate.body) };
  } catch (error) {
    logger.warn({ err: error, kind: candidate.kind }, "insight phrasing failed; using the template");
    return { title: candidate.title, body: candidate.body, phrasedByAI: false };
  }
}

export async function generateInsights(ctx: TenantContext, options: { now?: Date; phrase?: boolean } = {}) {
  const plan = await resolvePlan(ctx);
  if (!plan.features.aiInsights) return { skipped: "not in plan" as const, generated: 0, considered: 0 };
  const now = options.now ?? new Date();
  const filters = resolveFilters({ days: PERIOD_DAYS, to: now });
  const [org, profile] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true, name: true } }),
    ctx.db.businessProfile.findFirst({ select: { name: true } }),
  ]);
  const candidates = await runGenerators({ ctx, filters, currency: org.currency, now, periodLabel: `in the last ${PERIOD_DAYS} days` });
  const chosen = candidates.slice(0, MAX_INSIGHTS);
  const week = isoWeek(now);

  for (const candidate of chosen) {
    const words = options.phrase === false ? { title: candidate.title, body: candidate.body, phrasedByAI: false } : await phrase(ctx, candidate, profile?.name ?? org.name);
    const data = {
      kind: candidate.kind,
      title: words.title,
      body: words.body,
      metric: candidate.metric,
      currentValue: candidate.currentValue,
      comparisonValue: candidate.comparisonValue,
      comparisonLabel: candidate.comparisonLabel,
      supportingData: { ...candidate.supportingData, facts: candidate.facts, draft: { title: candidate.title, body: candidate.body } } as Prisma.InputJsonValue,
      confidence: Math.round(candidate.confidence * 100) / 100,
      sentiment: candidate.sentiment,
      campaignId: candidate.campaignId ?? null,
      periodStart: filters.from,
      periodEnd: filters.to,
      phrasedByAI: words.phrasedByAI,
      // createdAt marks the run that produced it; the latest run is the current set.
      createdAt: now,
    };
    const fingerprint = `${candidate.kind}:${candidate.key}:${week}`;
    await ctx.db.insight.upsert({
      where: { organizationId_fingerprint: { organizationId: ctx.organizationId, fingerprint } },
      create: { ...data, organizationId: ctx.organizationId, fingerprint },
      update: data,
    });
  }
  return { skipped: null, generated: chosen.length, considered: candidates.length };
}

export const insightListSchema = z.object({
  view: z.enum(["current", "history", "dismissed"]).default("current"),
});

export async function listInsights(ctx: TenantContext, input: z.input<typeof insightListSchema> = {}) {
  assertCan(ctx, "analytics:read");
  const { view } = insightListSchema.parse(input);
  const latest = await ctx.db.insight.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!latest) return { generatedAt: null, insights: [] };
  // Everything from the latest run (a run takes seconds; allow a margin).
  const runStart = new Date(latest.createdAt.getTime() - 5 * 60_000);
  const where: Prisma.InsightWhereInput =
    view === "current" ? { createdAt: { gte: runStart }, dismissedAt: null } : view === "dismissed" ? { dismissedAt: { not: null } } : { createdAt: { lt: runStart } };
  const insights = await ctx.db.insight.findMany({ where, orderBy: view === "current" ? [{ confidence: "desc" }, { createdAt: "desc" }] : { createdAt: "desc" }, take: view === "current" ? MAX_INSIGHTS : 40 });
  return { generatedAt: latest.createdAt, insights };
}

export async function setInsightDismissed(ctx: TenantContext, id: string, dismissed: boolean) {
  assertCan(ctx, "analytics:read");
  const insight = await ctx.db.insight.findFirst({ where: { id } });
  if (!insight) throw new NotFoundError("Insight", id);
  return ctx.db.insight.update({ where: { id }, data: { dismissedAt: dismissed ? new Date() : null } });
}
