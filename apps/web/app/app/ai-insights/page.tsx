import type { Metadata } from "next";
import { resolvePlan } from "@repo/core/billing/plans";
import { InsightsView } from "@/components/insights/insights-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "AI insights" };

export default async function InsightsPage() {
  const { ctx, membership } = await requireWorkspace();
  const plan = await resolvePlan(ctx);
  return (
    <PageContainer wide>
      <InsightsView enabled={Boolean(plan.features.aiInsights)} planName={plan.name} currency={membership.organization.currency} />
    </PageContainer>
  );
}
