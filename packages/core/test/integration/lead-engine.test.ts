import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { analyzeBusiness, replaceOfferings, upsertBusinessProfile } from "../../src/business/service";
import { addLeadsToCampaign } from "../../src/campaigns/audience";
import { createCampaign } from "../../src/campaigns/service";
import { isSuppressed } from "../../src/compliance/suppression";
import { executeDiscoveryRun, startDiscovery } from "../../src/discovery/service";
import { changeLeadStatus, createLead } from "../../src/leads/service";
import { PreconditionError } from "../../src/errors";
import { createWorkspace, resetDatabase, setPlan } from "./helpers";

async function workspaceWithProfile() {
  const workspace = await createWorkspace("Growth Co");
  await setPlan(workspace.organizationId, "pro");
  await upsertBusinessProfile(workspace.ctx, {
    name: "Growth Co",
    industry: "Marketing agency",
    description: "Social media and websites for cafés and restaurants in Delhi.",
    city: "New Delhi",
    businessSize: "SMALL",
    targetCustomerTypes: ["Cafés"],
  });
  await replaceOfferings(workspace.ctx, [{ type: "SERVICE", name: "Social media management", unitPrice: 30000 }]);
  await analyzeBusiness(workspace.ctx);
  return workspace;
}

describe("lead engine (mock providers)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("discovers, dedupes, enriches and scores leads with provenance", async () => {
    const { ctx } = await workspaceWithProfile();
    const run = await startDiscovery(ctx, { query: "cafés in South Delhi with 2+ locations", limit: 12 });
    const stats = await executeDiscoveryRun(ctx, run.id);

    expect(stats.found).toBe(12);
    expect(stats.new).toBe(12);
    expect(stats.scored).toBe(12);
    const leads = await ctx.db.lead.findMany({ include: { sources: true, scores: true, contacts: true } });
    expect(leads).toHaveLength(12);
    for (const lead of leads) {
      expect(lead.sourceProvider).toBe("mock");
      expect(lead.sources[0]?.rawData).toMatchObject({ simulated: true });
      expect(lead.scores[0]?.breakdown).toBeTruthy();
      expect(lead.enrichmentStatus).toBe("ENRICHED");
      expect(lead.website === null || lead.website.endsWith(".example")).toBe(true);
    }
    expect(await ctx.db.event.count({ where: { type: "lead_created" } })).toBe(12);

    // The same search again finds the same businesses: no new leads, no extra credits.
    const creditsBefore = (await ctx.db.usageCounter.findFirst({ where: { metric: "LEAD_CREDITS" } }))?.used;
    const rerun = await startDiscovery(ctx, { query: "cafés in South Delhi with 2+ locations", limit: 12 });
    const rerunStats = await executeDiscoveryRun(ctx, rerun.id);
    expect(rerunStats.new).toBe(0);
    expect(rerunStats.duplicates).toBe(12);
    expect((await ctx.db.usageCounter.findFirst({ where: { metric: "LEAD_CREDITS" } }))?.used).toBe(creditsBefore);
  });

  it("stops creating leads when lead credits run out", async () => {
    const { ctx, organizationId } = await workspaceWithProfile();
    await setPlan(organizationId, "free");
    const counter = await prisma.usageCounter.findFirst({ where: { organizationId, metric: "LEAD_CREDITS" } });
    const period = counter?.periodStart ?? (await prisma.subscription.findUniqueOrThrow({ where: { organizationId } })).currentPeriodStart;
    await prisma.usageCounter.upsert({
      where: { organizationId_metric_periodStart: { organizationId, metric: "LEAD_CREDITS", periodStart: period } },
      create: { organizationId, metric: "LEAD_CREDITS", periodStart: period, used: 97 },
      update: { used: 97 },
    });
    const run = await startDiscovery(ctx, { query: "restaurants in Gurugram", limit: 10 });
    const stats = await executeDiscoveryRun(ctx, run.id);
    expect(stats.new).toBe(3);
    expect(stats.creditsExhausted).toBe(true);
  });

  it("suppresses do-not-contact leads everywhere and blocks silent re-enabling", async () => {
    const { ctx } = await workspaceWithProfile();
    const lead = await createLead(ctx, { name: "Harbor Bistro", email: "owner@harbor.example", phone: "+91 99000 11111", city: "New Delhi" });
    const campaign = await createCampaign(ctx, { name: "Test", automationMode: "MANUAL", target: { categories: ["restaurant"] }, channels: ["EMAIL"] });
    await addLeadsToCampaign(ctx, campaign.id, [lead.id]);

    await changeLeadStatus(ctx, lead.id, "DO_NOT_CONTACT", "Asked not to be contacted");
    const updated = await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.doNotContact).toBe(true);
    expect((await ctx.db.campaignLead.findFirstOrThrow({ where: { leadId: lead.id } })).status).toBe("OPTED_OUT");
    expect((await isSuppressed(ctx, { email: "OWNER@harbor.example" }, { channel: "EMAIL" })).suppressed).toBe(true);
    expect((await isSuppressed(ctx, { phone: "099000 11111" }, { channel: "WHATSAPP" })).suppressed).toBe(true);

    await expect(changeLeadStatus(ctx, lead.id, "QUALIFIED")).rejects.toBeInstanceOf(PreconditionError);
    const readd = await addLeadsToCampaign(ctx, campaign.id, [lead.id]);
    expect(readd.added).toBe(0);
  });
});
