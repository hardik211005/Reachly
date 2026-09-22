import { beforeEach, describe, expect, it } from "vitest";
import { exportAnalyticsCsv, getAnalyticsReport, getBreakdown } from "../../src/analytics/report";
import type { TenantContext } from "../../src/context";
import { recordEvent } from "../../src/events";
import { generateInsights, listInsights, setInsightDismissed } from "../../src/insights/service";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * 10 leads emailed in Delhi (2 positive replies) and 10 leads called by the AI agent in Mumbai
 * (7 interested), plus one won deal worth 1,00,000 from a call.
 */
async function seedActivity(ctx: TenantContext) {
  for (let index = 0; index < 10; index += 1) {
    const lead = await createLead(ctx, { name: `Email lead ${index}`, city: "Delhi" });
    await recordEvent(ctx, { type: "email_sent", leadId: lead.id, channel: "EMAIL", occurredAt: daysAgo(6) });
    if (index < 2) await recordEvent(ctx, { type: "reply_classified", leadId: lead.id, channel: "EMAIL", properties: { intent: "POSITIVE" }, occurredAt: daysAgo(5) });
  }
  for (let index = 0; index < 10; index += 1) {
    const lead = await createLead(ctx, { name: `Call lead ${index}`, city: "Mumbai" });
    await recordEvent(ctx, { type: "call_completed", leadId: lead.id, channel: "VOICE", properties: { outcome: index < 7 ? "INTERESTED" : "NOT_INTERESTED" }, occurredAt: daysAgo(4) });
    if (index === 0) await recordEvent(ctx, { type: "deal_won", leadId: lead.id, channel: "VOICE", value: 100_000, occurredAt: daysAgo(2) });
  }
}

function metric(report: Awaited<ReturnType<typeof getAnalyticsReport>>, group: string, key: string) {
  return report.groups.find((item) => item.key === group)?.metrics.find((item) => item.key === key);
}

describe("analytics report", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("computes rates per contacted lead, revenue and channel breakdowns from events", async () => {
    const { ctx, organizationId } = await createWorkspace("Numbers Co");
    await setPlan(organizationId, "pro");
    await seedActivity(ctx);

    const report = await getAnalyticsReport(ctx, { days: 30 });
    expect(report.advanced).toBe(true);
    expect(metric(report, "engagement", "positiveReplyRate")?.value).toBeCloseTo(9 / 20, 6);
    expect(metric(report, "conversion", "conversionRate")?.value).toBeCloseTo(1 / 20, 6);
    expect(metric(report, "conversion", "revenue")?.value).toBe(100_000);
    // Nothing happened in the previous period: no fake comparison.
    expect(metric(report, "conversion", "revenue")?.previous).toBe(0);
    expect(report.costs?.total).toBeGreaterThan(0);
    expect(report.detail).not.toBeNull();

    const email = report.channels.find((row) => row.key === "EMAIL")!;
    const voice = report.channels.find((row) => row.key === "VOICE")!;
    expect(email).toMatchObject({ contacted: 10, positive: 2, positiveRate: 0.2 });
    expect(voice).toMatchObject({ contacted: 10, positive: 7, positiveRate: 0.7, won: 1, revenue: 100_000 });
  });

  it("filters by lead attributes and exports CSV", async () => {
    const { ctx, organizationId } = await createWorkspace("Filter Co");
    await setPlan(organizationId, "pro");
    await seedActivity(ctx);

    const mumbai = await getAnalyticsReport(ctx, { days: 30, city: "Mumbai" });
    expect(metric(mumbai, "engagement", "positiveReplyRate")?.value).toBeCloseTo(0.7, 6);
    const cities = await getBreakdown(ctx, { days: 30 }, "city");
    expect(cities.map((row) => row.key).sort()).toEqual(["Delhi", "Mumbai"]);

    const { filename, csv } = await exportAnalyticsCsv(ctx, { days: 30 }, "breakdown-channel");
    expect(filename).toMatch(/\.csv$/);
    const [header, ...rows] = csv.trim().split("\n");
    expect(header).toContain("contacted");
    expect(rows.some((row) => row.startsWith("Email") || row.includes(",Email,"))).toBe(true);
  });

  it("keeps advanced sections and costs to plans that include them", async () => {
    const { ctx } = await createWorkspace("Starter Co");
    await seedActivity(ctx);
    const report = await getAnalyticsReport(ctx, { days: 30 });
    expect(report.advanced).toBe(false);
    expect(report.detail).toBeNull();
    expect(report.costs).toBeNull();
    expect(report.groups.map((group) => group.key)).not.toContain("efficiency");
    expect(report.channels.length).toBeGreaterThan(0);
  });

  it("never mixes workspaces", async () => {
    const first = await createWorkspace("First Co");
    await setPlan(first.organizationId, "pro");
    await seedActivity(first.ctx);
    const second = await createWorkspace("Second Co");
    await setPlan(second.organizationId, "pro");
    const report = await getAnalyticsReport(second.ctx, { days: 30 });
    expect(metric(report, "conversion", "revenue")?.value).toBe(0);
    expect(report.channels).toEqual([]);
  });
});

describe("AI insights", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("proposes only significant findings, with their evidence, once per week", async () => {
    const { ctx, organizationId } = await createWorkspace("Insight Co");
    await setPlan(organizationId, "pro");
    await seedActivity(ctx);

    const result = await generateInsights(ctx, { phrase: false });
    expect(result.skipped).toBeNull();
    expect(result.generated).toBeGreaterThan(0);

    const { insights } = await listInsights(ctx);
    const channel = insights.find((insight) => insight.kind === "channel_comparison");
    expect(channel).toBeDefined();
    expect(channel!.title).toBe("AI calls get more positive responses than email");
    expect(channel!.body).toContain("70%");
    expect(channel!.body).toContain("20%");
    expect(channel!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(channel!.phrasedByAI).toBe(false);
    const evidence = channel!.supportingData as { method: string; facts: Record<string, unknown> };
    expect(evidence.method).toMatch(/z-test/);
    expect(evidence.facts).toMatchObject({ n: 10, otherN: 10 });
    for (const insight of insights) expect(insight.confidence).toBeGreaterThanOrEqual(0.3);

    // Running again in the same week updates rather than duplicating.
    await generateInsights(ctx, { phrase: false });
    expect(await ctx.db.insight.count()).toBe(result.generated);
  });

  it("dismisses and restores insights", async () => {
    const { ctx, organizationId } = await createWorkspace("Dismiss Co");
    await setPlan(organizationId, "pro");
    await seedActivity(ctx);
    await generateInsights(ctx, { phrase: false });
    const { insights } = await listInsights(ctx);
    const target = insights[0]!;

    await setInsightDismissed(ctx, target.id, true);
    expect((await listInsights(ctx)).insights.map((insight) => insight.id)).not.toContain(target.id);
    expect((await listInsights(ctx, { view: "dismissed" })).insights.map((insight) => insight.id)).toContain(target.id);

    await setInsightDismissed(ctx, target.id, false);
    expect((await listInsights(ctx)).insights.map((insight) => insight.id)).toContain(target.id);
  });

  it("stays quiet on plans without AI insights and when there is too little data", async () => {
    const free = await createWorkspace("Free Co");
    await seedActivity(free.ctx);
    expect(await generateInsights(free.ctx, { phrase: false })).toMatchObject({ skipped: "not in plan", generated: 0 });

    const empty = await createWorkspace("Empty Co");
    await setPlan(empty.organizationId, "pro");
    const lead = await createLead(empty.ctx);
    await recordEvent(empty.ctx, { type: "email_sent", leadId: lead.id, channel: "EMAIL", occurredAt: daysAgo(3) });
    expect(await generateInsights(empty.ctx, { phrase: false })).toMatchObject({ skipped: null, generated: 0 });
  });
});
