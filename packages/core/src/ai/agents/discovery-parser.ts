import { CATEGORIES, matchArea, matchCategories, matchCity } from "@repo/config/taxonomy";
import { z } from "zod";
import { SIGNAL_CATALOG } from "../../leads/signals";
import { defineAgent } from "../agent";

export interface DiscoveryParserInput {
  query: string;
  icpCategories: string[];
  icpLocations: string[];
  offerings: string[];
  defaultRadiusKm: number;
}

export const discoveryParseSchema = z.object({
  categories: z.array(z.string()).describe("Canonical category keys to search for."),
  keywords: z.array(z.string()),
  locationLabel: z.string().nullable().describe("Area to search, e.g. 'South Delhi'. null if not stated."),
  radiusKm: z.number().nullable(),
  criteria: z.string().nullable().describe("Qualifying conditions in plain words, e.g. 'independent cafés with 2+ locations'."),
  preferredSignals: z.array(z.string()),
  requireWebsite: z.boolean(),
  offer: z.string().nullable().describe("What the user wants to sell to these businesses, if stated."),
  interpretation: z.string().describe("One sentence explaining how the request was understood."),
});
export type DiscoveryParse = z.infer<typeof discoveryParseSchema>;

const SIGNAL_PATTERNS: Array<[RegExp, keyof typeof SIGNAL_CATALOG]> = [
  [/\b(2\+|two or more|multiple|several|chain|multi[- ]outlet|more than one)\s*(locations?|outlets?|branches|stores?)?/i, "multiple_locations"],
  [/\b(no|without)\s+(a\s+)?website\b/i, "no_website"],
  [/\b(new|newly|recently)\s+(opened|launched)|\bnew (cafe|café|restaurant|store)s?\b/i, "new_opening"],
  [/\bhiring|recruiting|growing team\b/i, "hiring"],
  [/\b(delivery|takeaway|take-away|take away)\b/i, "takeaway_delivery"],
  [/\b(premium|upscale|high[- ]end|luxury)\b/i, "premium_positioning"],
  [/\b(no|weak|poor)\s+(social|instagram)\b/i, "no_social_presence"],
];

/** Deterministic parser used by the mock provider (and as a sanity check for real models). */
export function mockDiscoveryParse(input: DiscoveryParserInput): DiscoveryParse {
  const query = input.query.trim();
  const categories = matchCategories(query).slice(0, 3).map((category) => category.key);
  const city = matchCity(query);
  const area = city ? matchArea(query, city) : undefined;
  const radius = /(\d{1,3})\s*(km|kilometres|kilometers)\b/i.exec(query)?.[1];
  const offerMatch = /(?:need|needs|want|wants|for|buy|use)\s+(?:our\s+|my\s+)?((?:custom|branded|new|better|more|a\s|an\s)?[a-z][a-z\s-]{3,60}?)(?:[.,]|$)/i.exec(query);
  const signals = SIGNAL_PATTERNS.filter(([pattern]) => pattern.test(query)).map(([, key]) => key);
  // Qualifying conditions stop where the offer starts ("…with 2+ locations that may need X").
  const criteriaMatch =
    /\b(with|that have|having|which have|without)\b[^.]{3,80}/i
      .exec(query)?.[0]
      ?.split(/\s+(?:that|who|which)\s+(?:may|might|could|would|need|needs|want|wants)\b/i)[0]
      ?.trim() ?? null;

  const finalCategories = categories.length ? categories : input.icpCategories.slice(0, 3);
  const locationLabel = area ? area.name.replace(/\b\w/g, (c) => c.toUpperCase()) : city ? city.name : (input.icpLocations[0] ?? null);
  const categoryLabels = finalCategories.map((key) => CATEGORIES.find((category) => category.key === key)?.label.toLowerCase() ?? key);

  return {
    categories: finalCategories,
    keywords: finalCategories.flatMap((key) => CATEGORIES.find((category) => category.key === key)?.keywords.slice(0, 2) ?? [key]).slice(0, 8),
    locationLabel,
    radiusKm: radius ? Number(radius) : null,
    criteria: criteriaMatch,
    preferredSignals: signals,
    requireWebsite: false,
    offer: offerMatch?.[1]?.trim() ?? input.offerings[0] ?? null,
    interpretation: `Searching for ${categoryLabels.join(", ") || "businesses"}${locationLabel ? ` in ${locationLabel}` : ""}${
      signals.length ? `, preferring ${signals.map((key) => SIGNAL_CATALOG[key].label.toLowerCase()).join(" and ")}` : ""
    }.`,
  };
}

export const discoveryParserAgent = defineAgent<DiscoveryParserInput, DiscoveryParse>({
  name: "discovery_parser",
  version: "v2",
  description: "Turns a natural-language lead request into structured search criteria.",
  output: discoveryParseSchema,
  effort: "low",
  maxTokens: 2000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You convert a user's description of the businesses they want to find into structured search criteria.",
        `Use these canonical category keys where they fit: ${CATEGORIES.map((category) => category.key).join(", ")}.`,
        `Signal keys you may use: ${Object.keys(SIGNAL_CATALOG).join(", ")}.`,
        "Only include what the user stated or clearly implied. If the user gives no location, return null for locationLabel.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: mockDiscoveryParse,
});
