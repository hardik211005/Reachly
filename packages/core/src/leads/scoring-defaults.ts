/**
 * Default lead scoring weights (sum to 100). Organisations can change them in
 * Settings → Scoring; the scoring engine normalises whatever weights are stored.
 */
export const SCORING_FACTORS = [
  "icpMatch",
  "industryMatch",
  "locationMatch",
  "sizeFit",
  "contactability",
  "digitalPresence",
  "buyingSignals",
] as const;
export type ScoringFactor = (typeof SCORING_FACTORS)[number];

export const SCORING_FACTOR_LABELS: Record<ScoringFactor, { label: string; description: string }> = {
  icpMatch: { label: "ICP match", description: "How closely the business matches your ideal customer profile." },
  industryMatch: { label: "Industry match", description: "Whether the category is one of your target industries." },
  locationMatch: { label: "Location match", description: "Distance from, or presence in, your target area." },
  sizeFit: { label: "Size fit", description: "Locations, reviews and team size versus your preferred customer size." },
  contactability: { label: "Contactability", description: "Availability of email, phone and WhatsApp contacts." },
  digitalPresence: { label: "Digital presence", description: "Website, social profiles and review footprint." },
  buyingSignals: { label: "Buying signals", description: "Public signals that suggest a need for your offer." },
};

export const DEFAULT_SCORING_WEIGHTS: Record<ScoringFactor, number> = {
  icpMatch: 25,
  industryMatch: 15,
  locationMatch: 15,
  sizeFit: 10,
  contactability: 15,
  digitalPresence: 10,
  buyingSignals: 10,
};

export const SCORING_VERSION = "rules-v1";
