import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { learnedModelSchema, MODEL_USEFUL_AUC, predictConversion, trainConversionModel, type LearnedModel, type Prediction, type TrainingSample, type TrainResult } from "./learned-model";
import { DEFAULT_SCORING_WEIGHTS, SCORING_FACTOR_LABELS, SCORING_FACTORS, type ScoringFactor } from "./scoring-defaults";
import { CHAIN_POLICIES, CHAIN_POLICY_LABELS, chainNameKey, chainSignal, isChainPolicy, readChainOverrides, type ChainOverrides, type ChainPolicy } from "./chains";
import { scoreLeadById } from "./scoring-service";
import { scoringRuleSchema } from "./scoring";
import type { LeadSignal } from "./signals";

/**
 * Settings → Scoring: factor weights, thresholds, custom rules, the AI qualification switch and
 * the learned conversion model trained on this workspace's outcomes.
 */

export const scoringSettingsSchema = z
  .object({
    weights: z.object(Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, z.number().int().min(0).max(100)])) as Record<ScoringFactor, z.ZodNumber>),
    rules: z.array(scoringRuleSchema).max(30),
    qualifiedThreshold: z.number().int().min(1).max(100),
    highFitThreshold: z.number().int().min(1).max(100),
    useAI: z.boolean(),
    chainPolicy: z.enum(CHAIN_POLICIES).default("neutral"),
  })
  .refine((value) => Object.values(value.weights).some((weight) => weight > 0), { message: "Give at least one factor a weight", path: ["weights"] })
  .refine((value) => value.highFitThreshold >= value.qualifiedThreshold, { message: "High fit must be at or above the qualified threshold", path: ["highFitThreshold"] });
export type ScoringSettingsInput = z.input<typeof scoringSettingsSchema>;

/** Lead statuses that count as converted once contacted. */
const CONVERTED = ["INTERESTED", "MEETING", "QUOTE_SENT", "WON"] as const;
/** Contacted but (so far) not converted. */
const NOT_CONVERTED = ["CONTACTED", "REPLIED", "LOST"] as const;
/** Leads contacted more recently than this haven't had a fair chance to respond yet. */
const MATURITY_DAYS = 7;

function readModel(value: unknown): LearnedModel | null {
  const parsed = learnedModelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function modelView(model: LearnedModel | null) {
  if (!model) return null;
  return {
    ...model,
    reliable: model.metrics.auc !== null && model.metrics.auc >= MODEL_USEFUL_AUC,
    importance: SCORING_FACTORS.map((factor) => ({ factor, label: SCORING_FACTOR_LABELS[factor].label, coefficient: model.coefficients[factor] ?? 0, suggestedWeight: model.suggestedWeights[factor] ?? 0 })).sort((a, b) => b.coefficient - a.coefficient),
  };
}

export async function getScoringSettings(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const [profile, trainingSet] = await Promise.all([ctx.db.scoringProfile.findFirst(), trainingSetSummary(ctx)]);
  const rules = scoringRuleSchema.array().safeParse(profile?.rules ?? []);
  return {
    weights: { ...DEFAULT_SCORING_WEIGHTS, ...((profile?.weights ?? {}) as Partial<Record<ScoringFactor, number>>) },
    defaults: DEFAULT_SCORING_WEIGHTS,
    factors: SCORING_FACTORS.map((factor) => ({ factor, ...SCORING_FACTOR_LABELS[factor] })),
    rules: rules.success ? rules.data : [],
    qualifiedThreshold: profile?.qualifiedThreshold ?? 65,
    highFitThreshold: profile?.highFitThreshold ?? 80,
    useAI: profile?.useAI ?? true,
    chainPolicy: (isChainPolicy(profile?.chainPolicy) ? profile.chainPolicy : "neutral") as ChainPolicy,
    chainPolicies: CHAIN_POLICIES.map((value) => ({ value, ...CHAIN_POLICY_LABELS[value] })),
    chainLeads: await ctx.db.lead.count({ where: { deletedAt: null, signals: { array_contains: [{ key: "chain_or_franchise" }] } } }),
    version: profile?.version ?? 1,
    updatedAt: profile?.updatedAt ?? null,
    model: modelView(readModel(profile?.learnedModel)),
    trainingSet,
  };
}

export async function updateScoringSettings(ctx: TenantContext, input: ScoringSettingsInput) {
  assertCan(ctx, "workspace:manage");
  const data = scoringSettingsSchema.parse(input);
  const values = {
    weights: data.weights as Prisma.InputJsonValue,
    rules: data.rules as unknown as Prisma.InputJsonValue,
    qualifiedThreshold: data.qualifiedThreshold,
    highFitThreshold: data.highFitThreshold,
    useAI: data.useAI,
    chainPolicy: data.chainPolicy,
  };
  const profile = await ctx.db.scoringProfile.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...values },
    update: { ...values, version: { increment: 1 } },
  });
  await audit(ctx, { action: "scoring.updated", resourceType: "scoring_profile", resourceId: profile.id, metadata: { weights: data.weights, rules: data.rules.length, qualifiedThreshold: data.qualifiedThreshold, highFitThreshold: data.highFitThreshold, useAI: data.useAI, chainPolicy: data.chainPolicy } });
  return getScoringSettings(ctx);
}

export async function getChainPolicy(ctx: TenantContext): Promise<ChainPolicy> {
  return (await getChainSettings(ctx)).policy;
}

export async function getChainSettings(ctx: TenantContext): Promise<{ policy: ChainPolicy; overrides: ChainOverrides }> {
  const profile = await ctx.db.scoringProfile.findFirst({ select: { chainPolicy: true, chainOverrides: true } });
  return { policy: isChainPolicy(profile?.chainPolicy) ? profile.chainPolicy : "neutral", overrides: readChainOverrides(profile?.chainOverrides) };
}

/**
 * Re-checks every saved lead for chain/franchise evidence (brand tags in its source records, or
 * several saved outlets sharing a name) and updates the signal. Leads saved before chain
 * detection existed get flagged here.
 */
export async function refreshChainSignals(ctx: TenantContext, options: { nameKey?: string } = {}) {
  assertCan(ctx, "leads:write");
  const { overrides } = await getChainSettings(ctx);
  const leads = await ctx.db.lead.findMany({ where: { deletedAt: null }, select: { id: true, name: true, dedupeKey: true, signals: true, sources: { select: { rawData: true } } }, take: 20_000 });
  const changedIds: string[] = [];
  const outlets = new Map<string, Set<string>>();
  for (const lead of leads) {
    const key = chainNameKey(lead.name);
    if (key.length < 3) continue;
    outlets.set(key, (outlets.get(key) ?? new Set<string>()).add(lead.dedupeKey));
  }
  let flagged = 0;
  let changed = 0;
  for (const lead of leads) {
    if (options.nameKey && chainNameKey(lead.name) !== options.nameKey) continue;
    const tags = lead.sources.map((source) => (source.rawData as { tags?: Record<string, string> } | null)?.tags).find((value) => value?.brand || value?.["brand:wikidata"]);
    const brand = tags ? { name: tags.brand ?? null, wikidata: tags["brand:wikidata"] ?? null } : null;
    const sameName = outlets.get(chainNameKey(lead.name));
    const current = (Array.isArray(lead.signals) ? lead.signals : []) as unknown as LeadSignal[];
    const had = current.find((item) => item.key === "chain_or_franchise");
    // Website evidence comes from enrichment and can't be re-derived here, so it's carried over.
    const websiteSignal = had?.source === "website" ? had : null;
    const signal = chainSignal({ name: lead.name, brand, sameNameOutlets: sameName ? sameName.size - 1 : 0, overrides, websiteSignal }, "chain-check");
    if (signal) flagged += 1;
    if (Boolean(had) === Boolean(signal) && (!signal || had?.evidence === signal.evidence)) continue;
    const next = [...current.filter((item) => item.key !== "chain_or_franchise"), ...(signal ? [signal] : [])];
    await ctx.db.lead.update({ where: { id: lead.id }, data: { signals: next as unknown as Prisma.InputJsonValue } });
    changed += 1;
    changedIds.push(lead.id);
  }
  return { checked: leads.length, chains: flagged, changed, changedIds };
}

/**
 * The team's own call: marks every outlet with this lead's name as a chain (or as independent,
 * overriding brand tags, website text and the built-in list). Applies to saved leads straight away
 * and to every future search.
 */
export async function markLeadChain(ctx: TenantContext, leadId: string, isChain: boolean) {
  assertCan(ctx, "leads:write");
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, name: true } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  const key = chainNameKey(lead.name);
  const profile = await ctx.db.scoringProfile.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, weights: DEFAULT_SCORING_WEIGHTS }, update: {} });
  const overrides = readChainOverrides(profile.chainOverrides);
  const next: ChainOverrides = {
    chains: isChain ? [...new Set([...overrides.chains, key])] : overrides.chains.filter((item) => item !== key),
    independents: isChain ? overrides.independents.filter((item) => item !== key) : [...new Set([...overrides.independents, key])],
  };
  await ctx.db.scoringProfile.update({ where: { id: profile.id }, data: { chainOverrides: next as unknown as Prisma.InputJsonValue } });
  await audit(ctx, { action: isChain ? "scoring.marked_chain" : "scoring.marked_independent", resourceType: "lead", resourceId: lead.id, metadata: { name: lead.name, nameKey: key } });
  // Every saved outlet with that name follows, and is re-scored so lists update immediately.
  const refreshed = await refreshChainSignals(ctx, { nameKey: key });
  const outlets = await ctx.db.lead.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  const affected = outlets.filter((item) => chainNameKey(item.name) === key);
  for (const item of affected) await scoreLeadById(ctx, item.id);
  return { name: lead.name, isChain, outlets: affected.length, changed: refreshed.changed };
}

/** Queues a fresh score for every active lead so new weights, rules and chain policy take effect. */
export async function rescoreAllLeads(ctx: TenantContext, options: { limit?: number } = {}) {
  assertCan(ctx, "leads:write");
  const chains = await refreshChainSignals(ctx);
  const limit = Math.min(options.limit ?? 5000, 5000);
  const leads = await ctx.db.lead.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "desc" }, take: limit });
  const stamp = Date.now();
  const queue = getQueue();
  for (const lead of leads) await queue.enqueue("leads.score", { organizationId: ctx.organizationId, leadId: lead.id }, { jobId: `rescore:${lead.id}:${stamp}` });
  await audit(ctx, { action: "scoring.rescore_all", resourceType: "scoring_profile", metadata: { queued: leads.length, chains: chains.chains } });
  return { queued: leads.length, chains: chains.chains };
}

// ----------------------------------------------------------------------------- Learned model

function factorsFromBreakdown(breakdown: unknown): Record<ScoringFactor, number> | null {
  const factors = (breakdown as { factors?: Array<{ factor: string; score: number }> } | null)?.factors;
  if (!Array.isArray(factors)) return null;
  const result = {} as Record<ScoringFactor, number>;
  for (const factor of SCORING_FACTORS) {
    const item = factors.find((entry) => entry.factor === factor);
    if (!item || typeof item.score !== "number") return null;
    result[factor] = item.score;
  }
  return result;
}

/**
 * Labelled examples from real outcomes: every scored lead that was contacted and has had time to
 * respond. A lead with a deal counts as converted even if it was later lost — it showed interest.
 */
export async function buildTrainingSet(ctx: TenantContext, now: Date = new Date()): Promise<TrainingSample[]> {
  const mature = new Date(now.getTime() - MATURITY_DAYS * 86_400_000);
  const leads = await ctx.db.lead.findMany({
    where: { deletedAt: null, status: { in: [...CONVERTED, ...NOT_CONVERTED] } },
    // Stable order → stable cross-validation folds, so metrics only change when the data does.
    orderBy: { id: "asc" },
    select: { status: true, lastActivityAt: true, updatedAt: true, _count: { select: { deals: true } }, scores: { orderBy: { createdAt: "desc" }, take: 1, select: { breakdown: true } } },
  });
  const samples: TrainingSample[] = [];
  for (const lead of leads) {
    const features = factorsFromBreakdown(lead.scores[0]?.breakdown);
    if (!features) continue;
    const converted = (CONVERTED as readonly string[]).includes(lead.status) || lead._count.deals > 0;
    if (!converted && lead.status === "CONTACTED" && (lead.lastActivityAt ?? lead.updatedAt) > mature) continue;
    samples.push({ features, label: converted ? 1 : 0 });
  }
  return samples;
}

async function trainingSetSummary(ctx: TenantContext) {
  const samples = await buildTrainingSet(ctx);
  const positives = samples.filter((sample) => sample.label === 1).length;
  return { samples: samples.length, positives, negatives: samples.length - positives };
}

export async function trainLearnedModel(ctx: TenantContext): Promise<TrainResult> {
  assertCan(ctx, "leads:write");
  const result = trainConversionModel(await buildTrainingSet(ctx));
  if (result.status === "trained") {
    const profile = await ctx.db.scoringProfile.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, weights: DEFAULT_SCORING_WEIGHTS, learnedModel: result.model as unknown as Prisma.InputJsonValue },
      update: { learnedModel: result.model as unknown as Prisma.InputJsonValue },
    });
    await audit(ctx, { action: "scoring.model_trained", resourceType: "scoring_profile", resourceId: profile.id, metadata: result.model.metrics });
  }
  return result;
}

/** Replaces the factor weights with the model's suggestion. Rules and thresholds are kept. */
export async function applySuggestedWeights(ctx: TenantContext) {
  assertCan(ctx, "workspace:manage");
  const profile = await ctx.db.scoringProfile.findFirst();
  const model = readModel(profile?.learnedModel);
  if (!profile || !model) throw new NotFoundError("Learned model");
  await ctx.db.scoringProfile.update({ where: { id: profile.id }, data: { weights: model.suggestedWeights as Prisma.InputJsonValue, version: { increment: 1 } } });
  await audit(ctx, { action: "scoring.model_weights_applied", resourceType: "scoring_profile", resourceId: profile.id, metadata: { from: profile.weights, to: model.suggestedWeights, auc: model.metrics.auc } });
  return getScoringSettings(ctx);
}

export async function clearLearnedModel(ctx: TenantContext) {
  assertCan(ctx, "workspace:manage");
  const profile = await ctx.db.scoringProfile.findFirst();
  if (profile) {
    await ctx.db.scoringProfile.update({ where: { id: profile.id }, data: { learnedModel: null as unknown as Prisma.InputJsonValue } });
    await audit(ctx, { action: "scoring.model_cleared", resourceType: "scoring_profile", resourceId: profile.id });
  }
  return getScoringSettings(ctx);
}

export type LeadConversion = Prediction & { drivers: Array<Prediction["drivers"][number] & { label: string }>; samples: number; auc: number | null; reliable: boolean; trainedAt: string };

/** Conversion probability for a lead from its latest score breakdown, or null without a model. */
export async function predictLeadConversion(ctx: TenantContext, breakdown: unknown): Promise<LeadConversion | null> {
  const features = factorsFromBreakdown(breakdown);
  if (!features) return null;
  const profile = await ctx.db.scoringProfile.findFirst({ select: { learnedModel: true } });
  const model = readModel(profile?.learnedModel);
  if (!model) return null;
  const prediction = predictConversion(model, features);
  return {
    ...prediction,
    drivers: prediction.drivers.map((driver) => ({ ...driver, label: SCORING_FACTOR_LABELS[driver.factor].label })),
    samples: model.metrics.samples,
    auc: model.metrics.auc,
    reliable: model.metrics.auc !== null && model.metrics.auc >= MODEL_USEFUL_AUC,
    trainedAt: model.trainedAt,
  };
}
