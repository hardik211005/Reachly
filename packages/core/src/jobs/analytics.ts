import { prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { resolvePlan } from "../billing/plans";
import { systemContext } from "../context";
import { generateInsights } from "../insights/service";
import { registerProcessor } from "./registry";

registerProcessor("analytics.insights", async ({ organizationId }) => generateInsights(systemContext(organizationId)));

/** Daily: regenerate insights for workspaces on a plan with AI insights and recent activity. */
registerProcessor("analytics.insights-all", async () => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const organizations = await prisma.organization.findMany({ where: { deletedAt: null, events: { some: { occurredAt: { gte: since } } } }, select: { id: true } });
  const day = new Date().toISOString().slice(0, 10);
  let queued = 0;
  for (const organization of organizations) {
    const plan = await resolvePlan(systemContext(organization.id));
    if (!plan.features.aiInsights) continue;
    await getQueue().enqueue("analytics.insights", { organizationId: organization.id }, { jobId: `insights:${organization.id}:${day}` });
    queued += 1;
  }
  return { queued };
});
