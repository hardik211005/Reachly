import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePlan } from "@repo/core/billing/plans";
import { callReadiness } from "@repo/core/calls/policy";
import { NotFoundError } from "@repo/core/errors";
import { n8nStatus } from "@repo/core/workflows/n8n";
import { getWorkflow } from "@repo/core/workflows/service";
import { WorkflowBuilder, type BuilderWorkflow } from "@/components/workflows/builder";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Workflow" };

async function load(ctx: Awaited<ReturnType<typeof requireWorkspace>>["ctx"], id: string) {
  try {
    return await getWorkflow(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspace();
  const { id } = await params;
  const [workflow, plan, campaigns, readiness, n8n] = await Promise.all([
    load(ctx, id),
    resolvePlan(ctx),
    ctx.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" } }),
    callReadiness(ctx),
    n8nStatus(ctx),
  ]);
  return (
    <WorkflowBuilder
      initial={JSON.parse(JSON.stringify(workflow)) as BuilderWorkflow}
      options={{ campaigns, n8nAllowed: plan.features.n8n, n8nMode: n8n.mode, callingReady: readiness.ready }}
    />
  );
}
