import { getCategory, haversineKm } from "@repo/config/taxonomy";
import { z } from "zod";
import type { Icp } from "../business/schemas";
import { DEFAULT_SCORING_WEIGHTS, SCORING_FACTORS, SCORING_FACTOR_LABELS, SCORING_VERSION, type ScoringFactor } from "./scoring-defaults";
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

function digitalPresence(lead: ScorableLead): Omit<FactorResult, "weight" | "label"> {
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
  return { factor: "digitalPresence", score: clamp(score), reasons };
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
  const raw = [icpMatch(lead, ctx), industryMatch(lead, ctx), locationMatch(lead, ctx), sizeFit(lead), contactability(lead), digitalPresence(lead), buyingSignals(lead, ctx)];
  const breakdown: FactorResult[] = raw.map((item) => ({ ...item, label: SCORING_FACTOR_LABELS[item.factor].label, weight: weights[item.factor] ?? 0 }));
  const totalWeight = breakdown.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weighted = breakdown.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;

  const adjustments = ctx.rules.filter((rule) => ruleMatches(rule, lead)).map((rule) => ({ label: rule.label, points: rule.points }));
  const total = lead.doNotContact ? 0 : clamp(weighted + adjustments.reduce((sum, item) => sum + item.points, 0));
  return {
    total,
    fitTier: total >= ctx.highFitThreshold ? "HIGH" : total >= 50 ? "MEDIUM" : "LOW",
    qualification: lead.doNotContact
      ? "UNQUALIFIED"
      : total >= ctx.qualifiedThreshold
        ? "QUALIFIED"
        : total >= ctx.qualifiedThreshold - 15
          ? "NEEDS_REVIEW"
          : "UNQUALIFIED",
    breakdown: SCORING_FACTORS.map((factor) => breakdown.find((item) => item.factor === factor) as FactorResult),
    adjustments,
    version: SCORING_VERSION,
  };
}

/** Recomputes the total after AI-adjusted factor scores, keeping rule adjustments. */
export function recomputeTotal(result: ScoreResult, ctx: Pick<ScoringContext, "qualifiedThreshold" | "highFitThreshold">, doNotContact: boolean): ScoreResult {
  const totalWeight = result.breakdown.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weighted = result.breakdown.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  const total = doNotContact ? 0 : clamp(weighted + result.adjustments.reduce((sum, item) => sum + item.points, 0));
  return {
    ...result,
    total,
    fitTier: total >= ctx.highFitThreshold ? "HIGH" : total >= 50 ? "MEDIUM" : "LOW",
    qualification: doNotContact ? "UNQUALIFIED" : total >= ctx.qualifiedThreshold ? "QUALIFIED" : total >= ctx.qualifiedThreshold - 15 ? "NEEDS_REVIEW" : "UNQUALIFIED",
  };
}
