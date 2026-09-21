/**
 * Public buying signals. Enrichment detects which apply to a lead (with evidence);
 * the ICP lists which matter for this seller; scoring measures the overlap.
 */

export const SIGNAL_CATALOG = {
  multiple_locations: { label: "Multiple locations", description: "Operates more than one outlet or office." },
  takeaway_delivery: { label: "Takeaway & delivery", description: "Offers takeaway or delivery (packaging demand)." },
  high_review_volume: { label: "High review volume", description: "Large number of public reviews — busy, established business." },
  few_reviews: { label: "Few reviews", description: "Small review footprint — room to grow reputation." },
  no_website: { label: "No website", description: "No website found for the business." },
  weak_website: { label: "Basic website", description: "Website exists but lacks key features (ordering, booking, SSL)." },
  no_social_presence: { label: "No social presence", description: "No active social media profiles found." },
  active_social: { label: "Active on social", description: "Maintains active social media profiles." },
  new_opening: { label: "Recently opened", description: "Appears to have opened recently." },
  hiring: { label: "Hiring", description: "Publicly advertising open roles." },
  hosts_events: { label: "Hosts events", description: "Hosts weddings, parties or corporate events." },
  premium_positioning: { label: "Premium positioning", description: "Higher price level / premium brand positioning." },
  no_online_ordering: { label: "No online ordering", description: "No direct online ordering or booking found." },
  growing: { label: "Growing", description: "Signals of expansion: new outlets, funding, team growth." },
} as const;

export type SignalKey = keyof typeof SIGNAL_CATALOG;
export const SIGNAL_KEYS = Object.keys(SIGNAL_CATALOG) as SignalKey[];

export interface LeadSignal {
  key: SignalKey | string;
  label: string;
  /** 0..1 strength of the evidence. */
  weight: number;
  evidence: string;
  source: string;
}

export function isSignalKey(value: string): value is SignalKey {
  return value in SIGNAL_CATALOG;
}
