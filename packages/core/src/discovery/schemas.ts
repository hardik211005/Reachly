import { z } from "zod";
import { campaignTargetSchema } from "../campaigns/schemas";

/** Structured discovery criteria — the campaign target shape plus a result limit and signal preferences. */
export const searchCriteriaSchema = campaignTargetSchema.extend({
  preferredSignals: z.array(z.string().max(40)).max(10).default([]),
  offer: z.string().trim().max(300).nullable().default(null),
});
export type SearchCriteria = z.output<typeof searchCriteriaSchema>;
export type SearchCriteriaInput = z.input<typeof searchCriteriaSchema>;

export const discoveryRequestSchema = z.object({
  query: z.string().trim().max(500).default(""),
  criteria: searchCriteriaSchema.optional(),
  campaignId: z.uuid().optional(),
  limit: z.number().int().min(5).max(250).default(40),
});
export type DiscoveryRequest = z.input<typeof discoveryRequestSchema>;

export interface DiscoveryStats {
  found: number;
  new: number;
  duplicates: number;
  skippedClosed: number;
  enriched: number;
  scored: number;
  highFit: number;
  qualified: number;
  contactable: number;
  creditsExhausted: boolean;
}

export function emptyStats(): DiscoveryStats {
  return { found: 0, new: 0, duplicates: 0, skippedClosed: 0, enriched: 0, scored: 0, highFit: 0, qualified: 0, contactable: 0, creditsExhausted: false };
}
