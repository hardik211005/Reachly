import { prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { systemContext } from "../context";
import { analyzeInboundMessage } from "../outreach/inbound";
import { sendMessage } from "../outreach/send";
import { prepareCampaignStep } from "../outreach/sequence";
import { runSimulationStep } from "../outreach/simulator";
import { processWebhookEvent } from "../outreach/webhooks";
import { registerProcessor } from "./registry";

const TICK_BATCH = 200;

/**
 * Every minute: find campaign leads whose next step is due in active campaigns and
 * queue step preparation. The job id is bucketed per 10 minutes so a failed prepare is
 * retried later, while prepareCampaignStep itself refuses to prepare a step twice.
 */
registerProcessor("sequences.tick", async () => {
  const now = new Date();
  const due = await prisma.campaignLead.findMany({
    where: { status: "IN_SEQUENCE", nextActionAt: { lte: now }, campaign: { status: "ACTIVE", deletedAt: null } },
    orderBy: { nextActionAt: "asc" },
    take: TICK_BATCH,
    select: { id: true, organizationId: true, nextStepOrder: true },
  });
  const bucket = Math.floor(now.getTime() / 600_000);
  for (const row of due) {
    await getQueue().enqueue("outreach.prepare-step", { organizationId: row.organizationId, campaignLeadId: row.id }, { jobId: `prep:${row.id}:${row.nextStepOrder}:${bucket}` });
  }
  return { queued: due.length };
});

registerProcessor("outreach.prepare-step", async ({ organizationId, campaignLeadId }) => {
  return prepareCampaignStep(systemContext(organizationId), campaignLeadId);
});

registerProcessor("messages.send", async ({ organizationId, messageId }) => {
  return sendMessage(systemContext(organizationId), messageId);
});

registerProcessor("conversations.analyze-inbound", async ({ organizationId, messageId }) => {
  const analysis = await analyzeInboundMessage(systemContext(organizationId), messageId);
  return analysis ? { intent: analysis.intent, optOut: analysis.optOut } : { skipped: true };
});

registerProcessor("demo.simulate", async (data) => runSimulationStep(data));

registerProcessor("webhooks.process", async ({ webhookEventId }) => processWebhookEvent(webhookEventId));
