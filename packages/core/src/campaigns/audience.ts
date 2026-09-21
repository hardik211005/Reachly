import { getQueue } from "@repo/queue";
import { isSuppressed } from "../compliance/suppression";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";

/**
 * Adds leads to a campaign audience. Do-not-contact / suppressed leads are skipped (and
 * reported), duplicates are ignored. If the campaign is already running, new members are
 * scheduled for the sequence immediately.
 */
export async function addLeadsToCampaign(ctx: TenantContext, campaignId: string, leadIds: string[]) {
  assertCan(ctx, "campaigns:write");
  const campaign = await ctx.db.campaign.findFirst({ where: { id: campaignId, deletedAt: null } });
  if (!campaign) throw new NotFoundError("Campaign", campaignId);
  if (campaign.status === "COMPLETED" || campaign.status === "ARCHIVED") throw new PreconditionError("This campaign has ended");

  const leads = await ctx.db.lead.findMany({
    where: { id: { in: leadIds }, deletedAt: null },
    select: { id: true, email: true, phone: true, doNotContact: true, primaryCampaignId: true },
  });
  const existing = new Set(
    (await ctx.db.campaignLead.findMany({ where: { campaignId, leadId: { in: leadIds } }, select: { leadId: true } })).map((row) => row.leadId),
  );

  const skipped: Array<{ leadId: string; reason: string }> = [];
  const toAdd: string[] = [];
  for (const lead of leads) {
    if (existing.has(lead.id)) {
      skipped.push({ leadId: lead.id, reason: "already in campaign" });
      continue;
    }
    if (lead.doNotContact) {
      skipped.push({ leadId: lead.id, reason: "do not contact" });
      continue;
    }
    const channel = campaign.channels[0] ?? "EMAIL";
    const suppression = await isSuppressed(ctx, { leadId: lead.id, email: lead.email, phone: lead.phone }, { channel, campaignId });
    if (suppression.suppressed) {
      skipped.push({ leadId: lead.id, reason: `suppressed (${suppression.reason.toLowerCase()})` });
      continue;
    }
    toAdd.push(lead.id);
  }

  const running = campaign.status === "ACTIVE";
  if (toAdd.length) {
    await ctx.db.campaignLead.createMany({
      data: toAdd.map((leadId) => ({
        organizationId: ctx.organizationId,
        campaignId,
        leadId,
        status: running ? "IN_SEQUENCE" : "PENDING",
        nextStepOrder: 0,
        nextActionAt: running ? new Date() : null,
      })),
      skipDuplicates: true,
    });
    await ctx.db.lead.updateMany({ where: { id: { in: toAdd }, primaryCampaignId: null }, data: { primaryCampaignId: campaignId } });
    for (const leadId of toAdd) {
      await recordEvent(ctx, { type: "lead_added_to_campaign", leadId, campaignId, properties: { campaign: campaign.name } });
    }
    if (running) await getQueue().enqueue("sequences.tick", {}, { jobId: `tick:${campaignId}:${Date.now()}` });
  }
  return { added: toAdd.length, skipped, notFound: leadIds.length - leads.length };
}

export async function removeLeadFromCampaign(ctx: TenantContext, campaignId: string, leadId: string) {
  assertCan(ctx, "campaigns:write");
  const row = await ctx.db.campaignLead.findFirst({ where: { campaignId, leadId } });
  if (!row) throw new NotFoundError("Campaign lead");
  await ctx.db.campaignLead.update({ where: { id: row.id }, data: { status: "STOPPED", stoppedReason: "Removed by user", nextActionAt: null } });
  await ctx.db.message.updateMany({
    where: { leadId, campaignId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } },
    data: { status: "CANCELED", error: "Removed from campaign" },
  });
}
