import { beforeEach, describe, expect, it } from "vitest";
import type { LeadStatus } from "@repo/db";
import { createTenantContext, type TenantContext } from "../../src/context";
import { applySuggestedWeights, buildTrainingSet, getScoringSettings, markLeadChain, trainLearnedModel, updateScoringSettings } from "../../src/leads/scoring-settings";
import { getLead, listLeads } from "../../src/leads/service";
import { SCORING_FACTORS } from "../../src/leads/scoring-defaults";
import { createLead, createWorkspace, resetDatabase } from "./helpers";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/** A contacted lead with a stored score breakdown, as the scoring engine would write it. */
async function scoredLead(ctx: TenantContext, status: LeadStatus, factors: Partial<Record<(typeof SCORING_FACTORS)[number], number>>, lastActivityAt = daysAgo(30)) {
  const lead = await createLead(ctx, { status, lastActivityAt });
  const breakdown = { factors: SCORING_FACTORS.map((factor) => ({ factor, label: factor, score: factors[factor] ?? 50, weight: 10, reasons: [] })), adjustments: [] };
  await ctx.db.leadScore.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, total: 50, fitTier: "MEDIUM", qualification: "NEEDS_REVIEW", breakdown, scoringVersion: "rules-v1" } });
  return lead;
}

/** 40 outcomes where contactability decides conversion. */
async function seedOutcomes(ctx: TenantContext) {
  for (let index = 0; index < 40; index += 1) {
    const contactable = index % 2 === 0;
    const converted = contactable ? index % 8 !== 0 : index % 10 === 1;
    await scoredLead(ctx, converted ? "INTERESTED" : "CONTACTED", { contactability: contactable ? 85 + (index % 10) : 10 + (index % 10), locationMatch: (index * 37) % 100 });
  }
}

describe("lead scoring settings and learned model", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("labels outcomes from lead status, deals and the maturity window", async () => {
    const { ctx } = await createWorkspace("Labels Co");
    await scoredLead(ctx, "WON", {});
    await scoredLead(ctx, "MEETING", {});
    const lostAfterDeal = await scoredLead(ctx, "LOST", {});
    await ctx.db.deal.create({ data: { organizationId: ctx.organizationId, leadId: lostAfterDeal.id, title: "Lost deal", stage: "LOST", value: 1000 } });
    await scoredLead(ctx, "REPLIED", {});
    await scoredLead(ctx, "CONTACTED", {}, daysAgo(30));
    await scoredLead(ctx, "CONTACTED", {}, daysAgo(1)); // too recent to judge
    await scoredLead(ctx, "NEW", {}); // never contacted
    await createLead(ctx, { status: "INTERESTED" }); // never scored

    const samples = await buildTrainingSet(ctx);
    expect(samples).toHaveLength(5);
    expect(samples.filter((sample) => sample.label === 1)).toHaveLength(3);
  });

  it("trains on real outcomes, predicts per lead and applies suggested weights", async () => {
    const { ctx } = await createWorkspace("Model Co");
    await seedOutcomes(ctx);

    const result = await trainLearnedModel(ctx);
    expect(result.status).toBe("trained");
    if (result.status !== "trained") return;
    expect(result.model.metrics.samples).toBe(40);
    expect(result.model.metrics.auc).toBeGreaterThan(0.75);

    const settings = await getScoringSettings(ctx);
    expect(settings.model?.importance[0]?.factor).toBe("contactability");

    const strong = await scoredLead(ctx, "NEW", { contactability: 95 });
    const weak = await scoredLead(ctx, "NEW", { contactability: 5 });
    const [strongView, weakView] = await Promise.all([getLead(ctx, strong.id), getLead(ctx, weak.id)]);
    expect(strongView.conversion?.probability).toBeGreaterThan(weakView.conversion?.probability ?? 1);

    const applied = await applySuggestedWeights(ctx);
    expect(applied.weights).toEqual(result.model.suggestedWeights);
    expect(applied.weights.contactability).toBeGreaterThan(applied.weights.locationMatch);
  });

  it("refuses to train on too few outcomes", async () => {
    const { ctx } = await createWorkspace("Thin Co");
    for (let index = 0; index < 6; index += 1) await scoredLead(ctx, index < 3 ? "INTERESTED" : "CONTACTED", {});
    const result = await trainLearnedModel(ctx);
    expect(result.status).toBe("insufficient_data");
    expect((await getScoringSettings(ctx)).model).toBeNull();
  });

  it("keeps each workspace's model and settings to itself", async () => {
    const a = await createWorkspace("Tenant A");
    const b = await createWorkspace("Tenant B");
    await seedOutcomes(a.ctx);
    await trainLearnedModel(a.ctx);
    expect((await getScoringSettings(a.ctx)).model).not.toBeNull();
    expect((await getScoringSettings(b.ctx)).model).toBeNull();
    expect(await buildTrainingSet(b.ctx)).toHaveLength(0);
  });

  it("validates settings and only lets admins change them", async () => {
    const { ctx, organizationId, userId } = await createWorkspace("Rules Co");
    const current = await getScoringSettings(ctx);
    const input = { weights: current.weights, rules: [{ field: "locationsCount" as const, operator: "gte" as const, value: 3, points: 10, label: "Multi-location" }], qualifiedThreshold: 60, highFitThreshold: 85, useAI: false };

    const saved = await updateScoringSettings(ctx, input);
    expect(saved.rules).toHaveLength(1);
    expect(saved.useAI).toBe(false);
    expect(saved.version).toBeGreaterThan(current.version);

    await expect(updateScoringSettings(ctx, { ...input, qualifiedThreshold: 90, highFitThreshold: 80 })).rejects.toThrow();
    await expect(updateScoringSettings(ctx, { ...input, weights: Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, 0])) as typeof input.weights })).rejects.toThrow();

    const member = createTenantContext({ organizationId, userId, role: "MEMBER" });
    await expect(updateScoringSettings(member, input)).rejects.toThrow();
  });
});

describe("chains in the leads list and the team's own call", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("marks every outlet of a name, hides chains when excluded, and lets the team undo it", async () => {
    const { ctx } = await createWorkspace("Chains Co");
    const first = await scoredLead(ctx, "NEW", {});
    await ctx.db.lead.update({ where: { id: first.id }, data: { name: "Got Tea", phone: "+919811111111" } });
    const second = await scoredLead(ctx, "NEW", {});
    await ctx.db.lead.update({ where: { id: second.id }, data: { name: "Got Tea - Sector 50", phone: "+919822222222" } });
    const independent = await scoredLead(ctx, "NEW", {});
    await ctx.db.lead.update({ where: { id: independent.id }, data: { name: "Oval Bean", phone: "+919833333333" } });

    const marked = await markLeadChain(ctx, first.id, true);
    expect(marked.outlets).toBe(2);
    const flagged = await ctx.db.lead.findMany({ where: { signals: { array_contains: [{ key: "chain_or_franchise" }] } }, select: { id: true } });
    expect(flagged.map((lead) => lead.id).sort()).toEqual([first.id, second.id].sort());

    const settings = await getScoringSettings(ctx);
    await updateScoringSettings(ctx, { weights: settings.weights, rules: [], qualifiedThreshold: 65, highFitThreshold: 80, useAI: false, chainPolicy: "exclude" });
    const hidden = await listLeads(ctx, {});
    expect(hidden.items.map((lead) => lead.id)).toEqual([independent.id]);
    expect(hidden.hiddenChains).toBe(2);
    expect((await listLeads(ctx, { chains: "show" })).items).toHaveLength(3);
    expect((await listLeads(ctx, { chains: "only" })).items).toHaveLength(2);

    await markLeadChain(ctx, second.id, false);
    expect(await ctx.db.lead.count({ where: { signals: { array_contains: [{ key: "chain_or_franchise" }] } } })).toBe(0);
    expect((await listLeads(ctx, {})).items).toHaveLength(3);
  });
});
