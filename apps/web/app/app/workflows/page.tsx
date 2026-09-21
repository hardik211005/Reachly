import type { Metadata } from "next";
import { resolvePlan } from "@repo/core/billing/plans";
import { PageContainer } from "@/components/page";
import { WorkflowsView } from "@/components/workflows/workflows-view";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const { ctx } = await requireWorkspace();
  const plan = await resolvePlan(ctx);
  return (
    <PageContainer wide>
      <WorkflowsView plan={{ workflows: plan.features.workflows, outboundWebhooks: plan.features.outboundWebhooks, limit: plan.limits.resources.workflows, name: plan.name }} />
    </PageContainer>
  );
}
