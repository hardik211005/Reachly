import type { Metadata } from "next";
import { getOverview } from "@repo/core/analytics/overview";
import { OverviewView, type InsightSummary } from "@/components/dashboard/overview-view";
import { OverviewHero } from "@/components/dashboard/overview-hero";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { ctx, membership, session } = await requireWorkspace();
  const { days } = await searchParams;
  const range = Number(days) > 0 ? Math.min(Number(days), 730) : 30;

  const [overview, insights] = await Promise.all([
    getOverview(ctx, { days: range }, membership.organization.timezone, membership.organization.currency),
    ctx.db.insight.findMany({ where: { dismissedAt: null }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);

  const insightSummaries: InsightSummary[] = insights.map((insight) => ({
    id: insight.id,
    title: insight.title,
    body: insight.body,
    sentiment: insight.sentiment,
    confidence: insight.confidence,
    comparisonLabel: insight.comparisonLabel,
  }));

  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: membership.organization.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <PageContainer wide>
      <OverviewHero
        greeting={`${greeting}, ${session.user.name.split(" ")[0]}`}
        workspace={membership.organization.name}
        days={range}
        revenue={overview.kpis.find((kpi) => kpi.key === "revenue")?.value ?? 0}
        meetings={overview.kpis.find((kpi) => kpi.key === "meetings")?.value ?? 0}
        currency={membership.organization.currency}
      />
      <OverviewView data={JSON.parse(JSON.stringify(overview))} currency={membership.organization.currency} insights={insightSummaries} />
    </PageContainer>
  );
}
