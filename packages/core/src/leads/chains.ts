import { KNOWN_CHAINS } from "@repo/config";
import type { LeadSignal } from "./signals";

/**
 * Chains and franchises. Outlets of a brand chain usually have central marketing, procurement and
 * IT, so for many sellers (agencies, local suppliers) they're poor leads; for others (packaging,
 * equipment) they're the best. Each workspace picks a policy, and every flag carries its evidence.
 */

export const CHAIN_POLICIES = ["prefer", "neutral", "avoid", "exclude"] as const;
export type ChainPolicy = (typeof CHAIN_POLICIES)[number];

export const CHAIN_POLICY_LABELS: Record<ChainPolicy, { label: string; description: string }> = {
  prefer: { label: "Prefer chains", description: "Chains and franchises score higher (+10)." },
  neutral: { label: "Treat like any business", description: "Chains are flagged but scored normally." },
  avoid: { label: "Avoid chains", description: "Chains are kept but scored down (−30) and never qualified." },
  exclude: { label: "Exclude chains", description: "Chains are skipped during discovery and use no lead credits; existing ones are scored down." },
};

export const CHAIN_SCORE_ADJUSTMENT: Record<ChainPolicy, number> = { prefer: 10, neutral: 0, avoid: -30, exclude: -30 };

export function isChainPolicy(value: unknown): value is ChainPolicy {
  return typeof value === "string" && (CHAIN_POLICIES as readonly string[]).includes(value);
}

/** Lower-cased name without punctuation or branch suffixes, so "Domino's - Saket" ≈ "Dominos". */
export function chainNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Combining accents (é → e)
    .replace(/[̀-ͯ]/g, "")
    // Branch suffixes: "Domino's - Saket", "CCD (Hauz Khas)", "Chaayos | CP"
    .replace(/\s+[-–|(@].*$/, "")
    // Apostrophes join the word: "Domino's" → "dominos"
    .replace(/['’`]/g, "")
    // Anything that isn't a letter, digit or combining mark (Devanagari vowel signs) becomes a space
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

export interface ChainEvidenceInput {
  name: string;
  brand: { name: string | null; wikidata: string | null } | null;
  /** Other outlets (different addresses) with the same name, in this search or already saved. */
  sameNameOutlets: number;
  /** The workspace's own call on this name, which beats every other signal. */
  overrides?: ChainOverrides;
  /** Evidence already found on the business's website (franchise page, outlet finder). */
  websiteSignal?: LeadSignal | null;
}

export interface ChainOverrides {
  chains: string[];
  independents: string[];
}

export function readChainOverrides(value: unknown): ChainOverrides {
  const raw = (value ?? {}) as Partial<ChainOverrides>;
  const list = (items: unknown) => (Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []);
  return { chains: list(raw.chains), independents: list(raw.independents) };
}

const KNOWN_CHAIN_KEYS = new Set(KNOWN_CHAINS.map(chainNameKey));

export function isKnownChain(name: string): boolean {
  return KNOWN_CHAIN_KEYS.has(chainNameKey(name));
}

/** A chain signal with the strongest available evidence, or null for an independent business. */
export function chainSignal(input: ChainEvidenceInput, source = "discovery"): LeadSignal | null {
  const key = chainNameKey(input.name);
  if (input.overrides?.independents.includes(key)) return null;
  if (input.overrides?.chains.includes(key)) {
    return { key: "chain_or_franchise", label: "Chain or franchise", weight: 1, evidence: "Marked as a chain by your team", source: "workspace" };
  }
  if (input.brand?.wikidata) {
    return { key: "chain_or_franchise", label: "Chain or franchise", weight: 1, evidence: `Recognised brand${input.brand.name ? ` “${input.brand.name}”` : ""} (Wikidata ${input.brand.wikidata})`, source };
  }
  if (input.brand?.name) {
    return { key: "chain_or_franchise", label: "Chain or franchise", weight: 0.9, evidence: `Tagged as part of the “${input.brand.name}” brand`, source };
  }
  if (isKnownChain(input.name)) {
    return { key: "chain_or_franchise", label: "Chain or franchise", weight: 0.95, evidence: "Well-known chain or franchise brand", source: "known-brands" };
  }
  if (input.websiteSignal) return input.websiteSignal;
  if (input.sameNameOutlets >= 1) {
    return { key: "chain_or_franchise", label: "Chain or franchise", weight: 0.7, evidence: `${input.sameNameOutlets + 1} outlets found with the name “${input.name}”`, source };
  }
  return null;
}

/** Counts how many times each name key appears, to spot several outlets of one brand. */
export function countNames(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = chainNameKey(name);
    if (key.length >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function isChainLead(signals: unknown): boolean {
  return Array.isArray(signals) && signals.some((signal) => (signal as LeadSignal | null)?.key === "chain_or_franchise");
}
