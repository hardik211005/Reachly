import type { Metadata } from "next";
import { Suspense } from "react";
import { getCategory } from "@repo/config/taxonomy";
import { resolvePlan } from "@repo/core/billing/plans";
import { AnalyticsView, type FilterOptions } from "@/components/analytics/analytics-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Analytics" };

const SOURCE_LABELS: Record<string, string> = { mock: "Demo data", google_places: "Google Places", manual: "Added manually", csv: "CSV import", import: "CSV import" };

export default async function AnalyticsPage() {
  const { ctx } = await requireWorkspace();
  const [plan, campaigns, cities, categories, sources] = await Promise.all([
    resolvePlan(ctx),
    ctx.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    ctx.db.lead.groupBy({ by: ["city"], where: { deletedAt: null, city: { not: null } }, _count: { _all: true }, orderBy: { _count: { city: "desc" } }, take: 30 }),
    ctx.db.lead.groupBy({ by: ["category"], where: { deletedAt: null, category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: "desc" } }, take: 30 }),
    ctx.db.lead.groupBy({ by: ["sourceProvider"], where: { deletedAt: null }, _count: { _all: true } }),
  ]);
  const options: FilterOptions = {
    campaigns,
    cities: cities.map((row) => row.city as string),
    categories: categories.map((row) => ({ value: row.category as string, label: getCategory(row.category as string)?.label ?? (row.category as string).replace(/_/g, " ") })),
    sources: sources.map((row) => ({ value: row.sourceProvider, label: SOURCE_LABELS[row.sourceProvider] ?? row.sourceProvider })),
  };
  return (
    <PageContainer wide>
      <Suspense>
        <AnalyticsView options={options} planName={plan.name} insightsEnabled={Boolean(plan.features.aiInsights)} />
      </Suspense>
    </PageContainer>
  );
}
