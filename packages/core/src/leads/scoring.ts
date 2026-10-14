import { getCategory, haversineKm } from "@repo/config/taxonomy";
import { z } from "zod";
import type { Icp } from "../business/schemas";
import { DEFAULT_SCORING_WEIGHTS, SCORING_FACTORS, SCORING_FACTOR_LABELS, SCORING_VERSION, type ScoringFactor } from "./scoring-defaults";
import { CHAIN_POLICY_LABELS, CHAIN_SCORE_ADJUSTMENT, type ChainPolicy } from "./chains";
import { SIGNAL_CATALOG, isSignalKey, type LeadSignal } from "./signals";

/**
 * Transparent lead scoring. Pure function of (lead, context): every factor returns a 0–100
 * score *and the reasons behind it*, so the UI can show exactly why a lead got its score.
 * The optional AI qualification step (see scoring-service.ts) can blend in, but its
 * contribution and reasoning are stored alongside — never a black box.
 */

export const scoringRuleSchema = z.object({
  field: z.enum(["category", "city", "locality", "industry", "reviewCount", "rating", "locationsCount", "hasWebsite", "hasEmail", "hasPhone", "signal"]),
  operator: z.enum(["eq", "neq", "gte", "lte", "contains", "exists", "not_exists"]),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  points: z.number().int().min(-50).max(50),
  label: z.string().min(1).max(80),
});
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export interface ScorableLead {
  name: string;
  category: string | null;
  industry: string | null;
  city: string | null;
  locality: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  socialProfiles: Record<string, string>;
  reviewCount: number | null;
  rating: number | null;
  locationsCount: number | null;
  signals: LeadSignal[];
  contacts: Array<{ name: string | null; email: string | null; phone: string | null }>;
  doNotContact: boolean;
}

export interface ScoringTarget {
  categories: string[];
  locations: Array<{ label: string; city: string | null; lat: number | null; lng: number | null; localities?: string[] }>;
  radiusKm: number;
  preferredSignals: string[];
  criteria: string | null;
}

export interface ScoringContext {
  icp: Icp | null;
  target: ScoringTarget;
  weights: Partial<Record<ScoringFactor, number>>;
  rules: ScoringRule[];
  qualifiedThreshold: number;
  highFitThreshold: number;
  /** How chain/franchise outlets are treated. Defaults to neutral. */
  chainPolicy?: ChainPolicy;
}

export interface FactorResult {
  factor: ScoringFactor;
  label: string;
  score: number;
  weight: number;
  reasons: string[];
}

export interface ScoreResult {
  total: number;
  fitTier: "HIGH" | "MEDIUM" | "LOW";
  qualification: "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED";
  breakdown: FactorResult[];
  adjustments: Array<{ label: string; points: number }>;
  /** Why the lead can never be qualified (e.g. the workspace avoids chains), when that applies. */
  disqualifiedBy?: string;
  /** Why the lead is held at Needs review at most (e.g. no way to contact it yet). */
  reviewReason?: string;
  version: string;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));
const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function icpMatch(lead: ScorableLead, ctx: ScoringContext): Omit<FactorResult, "weight" | "label"> {
  const reasons: string[] = [];
  const category = lead.category ? getCategory(lead.category) : undefined;
  const categoryLabel = category?.label ?? lead.category ?? "Unknown category";
  const targetCategories = ctx.target.categories.length ? ctx.target.categories : (ctx.icp?.targetCategories ?? []);
  let score: number;

  if (lead.category && ctx.target.categories.includes(lead.category)) {
    score = 100;
    reasons.push(`${categoryLabel} is a target category for this search`);
  } else if (lead.category && ctx.icp?.targetCategories.includes(lead.category)) {
    score = 85;
    reasons.push(`${categoryLabel} is in your ideal customer profile`);
  } else if (category && targetCategories.some((key) => getCategory(key)?.industry === category.industry)) {
    score = 60;
    reasons.push(`Same industry as your targets (${category.industry})`);
  } else if (ctx.icp?.leadKeywords.some((keyword) => lower(lead.name).includes(lower(keyword)) || lower(lead.category).includes(lower(keyword)))) {
    score = 45;
    reasons.push("Name or category matches your lead keywords");
  } else {
    score = 15;
    reasons.push(`${categoryLabel} is not one of your target categories`);
  }

  const criteria = lower(ctx.target.criteria);
  const wantsMultiple = /(2\+|two or more|multiple|chain|more than one)/.test(criteria);
  if (wantsMultiple) {
    if ((lead.locationsCount ?? 1) >= 2) {
      score += 10;
      reasons.push(`Meets "${ctx.target.criteria}" (${lead.locationsCount} locations)`);
    } else {
      score -= 20;
      reasons.push(`Single location — criteria asks for "${ctx.target.criteria}"`);
    }
  }
  return { factor: "icpMatch", score: clamp(score), reasons };
}

function industryMatch(lead: ScorableLead, ctx: ScoringContext): Omit<FactorResult, "weight" | "label"> {
  const industries = (ctx.icp?.targetIndustries ?? []).map(lower);
  if (!industries.length) return { factor: "industryMatch", score: 60, reasons: ["No target industries set — neutral"] };
  const industry = lower(lead.industry);
  if (industry && industries.some((target) => target === industry || target.includes(industry) || industry.includes(target))) {
    return { factor: "industryMatch", score: 100, reasons: [`${lead.industry} is a target industry`] };
  }
  return { factor: "industryMatch", score: 25, reasons: [lead.industry ? `${lead.industry} is outside your target industries` : "Industry unknown"] };
}

function locationMatch(lead: ScorableLead, ctx: ScoringContext): Omit<FactorResult, "weight" | "label"> {
  const locations = ctx.target.locations;
  if (!locations.length) return { factor: "locationMatch", score: 60, reasons: ["No target location set — neutral"] };
  const radius = Math.max(1, ctx.target.radiusKm);

  if (lead.latitude !== null && lead.longitude !== null) {
    const distances = locations
      .filter((location) => location.lat !== null && location.lng !== null)
      .map((location) => ({ location, km: haversineKm({ lat: lead.latitude as number, lng: lead.longitude as number }, { lat: location.lat as number, lng: location.lng as number }) }))
      .sort((a, b) => a.km - b.km);
    const nearest = distances[0];
    if (nearest) {
      const km = Math.round(nearest.km * 10) / 10;
      if (nearest.km <= radius) return { factor: "locationMatch", score: clamp(100 - 40 * (nearest.km / radius), 60), reasons: [`${km} km from ${nearest.location.label} (within ${radius} km)`] };
      if (nearest.km <= radius * 2) return { factor: "locationMatch", score: 40, reasons: [`${km} km from ${nearest.location.label} — outside the ${radius} km radius`] };
      return { factor: "locationMatch", score: 10, reasons: [`${km} km from ${nearest.location.label} — far outside the target area`] };
    }
  }

  const locality = lower(lead.locality);
  const city = lower(lead.city);
  if (locality && locations.some((location) => location.localities?.some((name) => lower(name) === locality))) {
    return { factor: "locationMatch", score: 100, reasons: [`Located in ${lead.locality}`] };
  }
  if (city && locations.some((location) => lower(location.city) === city || lower(location.label).includes(city) || city.includes(lower(location.label)))) {
    return { factor: "locationMatch", score: 85, reasons: [`Located in ${lead.city}`] };
  }
  return { factor: "locationMatch", score: lead.city ? 20 : 30, reasons: [lead.city ? `${lead.city} is outside the target area` : "Location unknown"] };
}

function sizeFit(lead: ScorableLead): Omit<FactorResult, "weight" | "label"> {
  const reasons: string[] = [];
  let score = 40;
  const locations = lead.locationsCount ?? 1;
  if (locations >= 4) {
    score += 45;
    reasons.push(`${locations} locations`);
  } else if (locations >= 2) {
    score += 30;
    reasons.push(`${locations} locations`);
  } else reasons.push("Single location");
  if ((lead.reviewCount ?? 0) >= 200) {
    score += 25;
    reasons.push(`${lead.reviewCount} public reviews — high volume`);
  } else if ((lead.reviewCount ?? 0) >= 50) {
    score += 15;
    reasons.push(`${lead.reviewCount} public reviews`);
  } else if (lead.reviewCount !== null) reasons.push(`${lead.reviewCount} public reviews — small footprint`);
  return { factor: "sizeFit", score: clamp(score), reasons };
}

function contactability(lead: ScorableLead): Omit<FactorResult, "weight" | "label"> {
  if (lead.doNotContact) return { factor: "contactability", score: 0, reasons: ["Marked do-not-contact"] };
  const reasons: string[] = [];
  let score = 0;
  const email = lead.email ?? lead.contacts.find((contact) => contact.email)?.email;
  const phone = lead.phone ?? lead.contacts.find((contact) => contact.phone)?.phone;
  if (email) {
    score += 40;
    reasons.push("Business email available");
  } else reasons.push("No email found");
  if (phone) {
    score += 30;
    reasons.push("Phone number available");
    if (/^\+91[6-9]\d{9}$/.test(phone.replace(/\s/g, ""))) {
      score += 10;
      reasons.push("Mobile number (WhatsApp-capable)");
    }
  } else reasons.push("No phone number");
  if (lead.contacts.some((contact) => contact.name)) {
    score += 20;
    reasons.push("Named decision-maker contact");
  }
  return { factor: "contactability", score: clamp(score), reasons };
}

/** Signals that mean a business lacks something online — i.e. needs a digital/marketing seller. */
const NEED_SIGNALS = new Set(["no_website", "weak_website", "no_social_presence", "few_reviews", "no_online_ordering"]);

/** True when the seller's buying signals are about gaps (they sell what the business lacks). */
export function sellsToDigitalGaps(ctx: ScoringContext): boolean {
  return isGapSeller([...(ctx.icp?.buyingSignals.map((signal) => signal.key) ?? []), ...ctx.target.preferredSignals]);
}

export function isGapSeller(signalKeys: string[]): boolean {
  return signalKeys.some((key) => NEED_SIGNALS.has(key));
}

function digitalPresence(lead: ScorableLead, ctx: ScoringContext): Omit<FactorResult, "weight" | "label"> {
  const presence = digitalPresenceScore(lead);
  if (!sellsToDigitalGaps(ctx)) return { factor: "digitalPresence", ...presence };
  // The seller fixes weak online presence, so a strong one means less need for them.
  const gap = clamp(100 - presence.score);
  const verdict = gap >= 60 ? "Weak online presence — clear room for your offer" : gap >= 35 ? "Some online presence — partial room for your offer" : "Strong online presence already — less need for your offer";
  return { factor: "digitalPresence", score: gap, reasons: [verdict, ...presence.reasons] };
}

function digitalPresenceScore(lead: ScorableLead): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (lead.website) {
    score += 35;
    reasons.push("Has a website");
    if (lead.website.startsWith("https://")) score += 10;
  } else reasons.push("No website");
  const socials = Object.keys(lead.socialProfiles);
  if (socials.length) {
    score += Math.min(30, socials.length * 12);
    reasons.push(`Social: ${socials.join(", ")}`);
  }
  if ((lead.reviewCount ?? 0) >= 30) score += 15;
  if ((lead.rating ?? 0) >= 4.2) {
    score += 10;
    reasons.push(`Rated ${lead.rating}★`);
  }
  return { score: clamp(score), reasons };
}

function buyingSignals(lead: ScorableLead, ctx: ScoringContext): Omit<FactorResult, "weight" | "label"> {
  const wanted = new Set([...(ctx.icp?.buyingSignals.map((signal) => signal.key) ?? []), ...ctx.target.preferredSignals]);
  if (!wanted.size) return { factor: "buyingSignals", score: 50, reasons: ["No buying signals configured — neutral"] };
  const matched = lead.signals.filter((signal) => wanted.has(signal.key));
  if (!matched.length) return { factor: "buyingSignals", score: 10, reasons: ["None of your buying signals were found"] };
  const score = clamp(20 + matched.reduce((sum, signal) => sum + signal.weight * 40, 0));
  return {
    factor: "buyingSignals",
    score,
    reasons: matched.map((signal) => `${isSignalKey(signal.key) ? SIGNAL_CATALOG[signal.key].label : signal.label}: ${signal.evidence}`),
  };
}

function ruleMatches(rule: ScoringRule, lead: ScorableLead): boolean {
  const values: Record<ScoringRule["field"], unknown> = {
    category: lead.category,
    city: lead.city,
    locality: lead.locality,
    industry: lead.industry,
    reviewCount: lead.reviewCount,
    rating: lead.rating,
    locationsCount: lead.locationsCount,
    hasWebsite: Boolean(lead.website),
    hasEmail: Boolean(lead.email ?? lead.contacts.find((contact) => contact.email)),
    hasPhone: Boolean(lead.phone),
    signal: lead.signals.map((signal) => signal.key),
  };
  const actual = values[rule.field];
  switch (rule.operator) {
    case "exists":
      return Array.isArray(actual) ? actual.includes(rule.value) : actual !== null && actual !== undefined && actual !== false;
    case "not_exists":
      return Array.isArray(actual) ? !actual.includes(rule.value) : actual === null || actual === undefined || actual === false;
    case "eq":
      return Array.isArray(actual) ? actual.includes(rule.value) : lower(String(actual)) === lower(String(rule.value));
    case "neq":
      return Array.isArray(actual) ? !actual.includes(rule.value) : lower(String(actual)) !== lower(String(rule.value));
    case "contains":
      return lower(String(actual)).includes(lower(String(rule.value)));
    case "gte":
      return typeof actual === "number" && actual >= Number(rule.value);
    case "lte":
      return typeof actual === "number" && actual <= Number(rule.value);
  }
}

export function scoreLead(lead: ScorableLead, ctx: ScoringContext): ScoreResult {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...ctx.weights };
  const raw = [icpMatch(lead, ctx), industryMatch(lead, ctx), locationMatch(lead, ctx), sizeFit(lead), contactability(lead), digitalPresence(lead, ctx), buyingSignals(lead, ctx)];
  const gapMode = sellsToDigitalGaps(ctx);
  const breakdown: FactorResult[] = raw.map((item) => ({ ...item, label: item.factor === "digitalPresence" && gapMode ? "Digital gap" : SCORING_FACTOR_LABELS[item.factor].label, weight: weights[item.factor] ?? 0 }));
  const totalWeight = breakdown.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weighted = breakdown.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;

  const adjustments = ctx.rules.filter((rule) => ruleMatches(rule, lead)).map((rule) => ({ label: rule.label, points: rule.points }));
  const policy = ctx.chainPolicy ?? "neutral";
  const isChain = lead.signals.some((signal) => signal.key === "chain_or_franchise");
  if (isChain && CHAIN_SCORE_ADJUSTMENT[policy] !== 0) adjustments.push({ label: `Chain or franchise (${CHAIN_POLICY_LABELS[policy].label.toLowerCase()})`, points: CHAIN_SCORE_ADJUSTMENT[policy] });
  const disqualifiedBy = isChain && (policy === "avoid" || policy === "exclude") ? "Chain or franchise — your workspace avoids these" : undefined;
  // A lead nobody can reach isn't ready for outreach, however good the fit.
  const reachable = Boolean(lead.email || lead.phone || lead.contacts.some((contact) => contact.email || contact.phone));
  const reviewReason = reachable ? undefined : "No phone or email yet — find a contact before outreach";
  const total = lead.doNotContact ? 0 : clamp(weighted + adjustments.reduce((sum, item) => sum + item.points, 0));
  return {
    total,
    fitTier: tierFor(total, ctx),
    qualification: qualificationFor(total, ctx, lead.doNotContact, disqualifiedBy, reviewReason),
    breakdown: SCORING_FACTORS.map((factor) => breakdown.find((item) => item.factor === factor) as FactorResult),
    adjustments,
    ...(disqualifiedBy ? { disqualifiedBy } : {}),
    ...(reviewReason ? { reviewReason } : {}),
    version: SCORING_VERSION,
  };
}

function tierFor(total: number, ctx: Pick<ScoringContext, "highFitThreshold">): ScoreResult["fitTier"] {
  return total >= ctx.highFitThreshold ? "HIGH" : total >= 50 ? "MEDIUM" : "LOW";
}

function qualificationFor(total: number, ctx: Pick<ScoringContext, "qualifiedThreshold">, doNotContact: boolean, disqualifiedBy?: string, reviewReason?: string): ScoreResult["qualification"] {
  if (doNotContact || disqualifiedBy) return "UNQUALIFIED";
  const qualification = total >= ctx.qualifiedThreshold ? "QUALIFIED" : total >= ctx.qualifiedThreshold - 15 ? "NEEDS_REVIEW" : "UNQUALIFIED";
  return qualification === "QUALIFIED" && reviewReason ? "NEEDS_REVIEW" : qualification;
}

/** Recomputes the total after AI-adjusted factor scores, keeping rule adjustments. */
export function recomputeTotal(result: ScoreResult, ctx: Pick<ScoringContext, "qualifiedThreshold" | "highFitThreshold">, doNotContact: boolean): ScoreResult {
  const totalWeight = result.breakdown.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weighted = result.breakdown.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  const total = doNotContact ? 0 : clamp(weighted + result.adjustments.reduce((sum, item) => sum + item.points, 0));
  return { ...result, total, fitTier: tierFor(total, ctx), qualification: qualificationFor(total, ctx, doNotContact, result.disqualifiedBy, result.reviewReason) };
}
