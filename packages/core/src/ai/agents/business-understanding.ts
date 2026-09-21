import type { Channel } from "@repo/config";
import { icpSchema, type Icp } from "../../business/schemas";
import { SIGNAL_CATALOG, type SignalKey } from "../../leads/signals";
import { CATEGORIES, getCategory, matchCategories, matchCity, CITIES } from "@repo/config/taxonomy";
import { defineAgent } from "../agent";

export interface BusinessUnderstandingInput {
  name: string;
  website: string | null;
  industry: string;
  description: string;
  city: string | null;
  region: string | null;
  country: string | null;
  businessSize: string;
  pricingModel: string | null;
  targetIndustries: string[];
  targetCustomerTypes: string[];
  offerings: Array<{
    type: string;
    name: string;
    description: string | null;
    unitPrice: number | null;
    currency: string;
    minOrderQuantity: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Deterministic mock: grounded in the profile text, never invents facts or prices.
// ---------------------------------------------------------------------------

type SellerArchetype =
  | "packaging"
  | "marketing"
  | "web"
  | "photography"
  | "recruitment"
  | "software"
  | "supplies"
  | "general";

const ARCHETYPE_KEYWORDS: Array<[SellerArchetype, string[]]> = [
  ["packaging", ["packaging", "cup", "cups", "box", "boxes", "carton", "bag", "label", "printing", "container"]],
  ["marketing", ["marketing", "social media", "seo", "branding", "ads", "advertising", "content", "influencer"]],
  ["web", ["website", "web development", "e-commerce", "ecommerce", "shopify", "app development", "web design"]],
  ["photography", ["photography", "photographer", "videography", "photo", "shoot", "film"]],
  ["recruitment", ["recruitment", "hiring", "staffing", "talent", "headhunting", "placement"]],
  ["software", ["saas", "software", "platform", "crm", "pos", "subscription software"]],
  ["supplies", ["supplies", "wholesale", "distributor", "manufacturer", "raw material", "equipment"]],
];

const ARCHETYPE_DEFAULTS: Record<
  SellerArchetype,
  { categories: string[]; signals: SignalKey[]; persona: { title: string; goals: string[]; painPoints: string[] }[] }
> = {
  packaging: {
    categories: ["cafe", "restaurant", "cloud_kitchen", "bakery", "d2c_brand"],
    signals: ["multiple_locations", "takeaway_delivery", "high_review_volume", "growing"],
    persona: [
      { title: "Owner / Founder", goals: ["Stronger brand recall", "Control packaging costs"], painPoints: ["Generic packaging", "Unreliable suppliers"] },
      { title: "Operations / Purchase manager", goals: ["Consistent supply", "Predictable pricing"], painPoints: ["Stock-outs", "Minimum order quantities"] },
    ],
  },
  marketing: {
    categories: ["cafe", "restaurant", "salon", "gym", "clinic", "retail_store"],
    signals: ["no_social_presence", "few_reviews", "weak_website", "multiple_locations"],
    persona: [
      { title: "Owner / Founder", goals: ["More footfall and orders", "Consistent online presence"], painPoints: ["No time for marketing", "Agencies that don't show results"] },
      { title: "Marketing lead", goals: ["Qualified leads", "Measurable ROI"], painPoints: ["Low engagement", "Content bottlenecks"] },
    ],
  },
  web: {
    categories: ["retail_store", "clinic", "restaurant", "salon", "real_estate", "school"],
    signals: ["no_website", "weak_website", "no_online_ordering", "growing"],
    persona: [
      { title: "Owner / Founder", goals: ["Take bookings and orders online", "Look credible"], painPoints: ["Outdated website", "Lost enquiries"] },
    ],
  },
  photography: {
    categories: ["event_venue", "wedding_planner", "hotel", "corporate_office"],
    signals: ["hosts_events", "premium_positioning", "high_review_volume"],
    persona: [
      { title: "Venue / events manager", goals: ["Reliable vendor partners", "Great event portfolios"], painPoints: ["Inconsistent vendors", "Last-minute cancellations"] },
      { title: "Wedding planner", goals: ["Delighted clients", "Referral-worthy results"], painPoints: ["Coordinating many vendors"] },
    ],
  },
  recruitment: {
    categories: ["startup", "corporate_office", "manufacturer", "agency"],
    signals: ["hiring", "growing", "multiple_locations"],
    persona: [
      { title: "HR / Talent lead", goals: ["Fill roles faster", "Better-fit candidates"], painPoints: ["Long time-to-hire", "Low-quality applicants"] },
      { title: "Founder / CEO", goals: ["Scale the team"], painPoints: ["Hiring distracts from the business"] },
    ],
  },
  software: {
    categories: ["restaurant", "retail_store", "clinic", "gym", "school"],
    signals: ["multiple_locations", "growing", "no_online_ordering"],
    persona: [
      { title: "Owner / Operations head", goals: ["Streamlined operations", "Better visibility"], painPoints: ["Manual processes", "Disconnected tools"] },
    ],
  },
  supplies: {
    categories: ["restaurant", "hotel", "retail_store", "manufacturer"],
    signals: ["multiple_locations", "high_review_volume", "growing"],
    persona: [
      { title: "Purchase manager", goals: ["Reliable supply at good prices"], painPoints: ["Supplier delays", "Quality inconsistency"] },
    ],
  },
  general: {
    categories: ["corporate_office", "retail_store", "restaurant"],
    signals: ["multiple_locations", "growing", "high_review_volume"],
    persona: [{ title: "Owner / Decision maker", goals: ["Grow revenue", "Save time"], painPoints: ["Too many vendors pitching generic offers"] }],
  },
};

function detectArchetype(text: string): SellerArchetype {
  const haystack = text.toLowerCase();
  let best: SellerArchetype = "general";
  let bestScore = 0;
  for (const [archetype, keywords] of ARCHETYPE_KEYWORDS) {
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      best = archetype;
      bestScore = score;
    }
  }
  return best;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function mockBusinessUnderstanding(input: BusinessUnderstandingInput): Icp {
  const offeringText = input.offerings.map((o) => `${o.name} ${o.description ?? ""}`).join(" ");
  const archetype = detectArchetype(`${input.industry} ${input.description} ${offeringText}`);
  const defaults = ARCHETYPE_DEFAULTS[archetype];

  const statedCategories = unique(
    [...input.targetCustomerTypes, ...input.targetIndustries].flatMap((text) => matchCategories(text).slice(0, 2)),
  );
  const categories = (statedCategories.length ? statedCategories : defaults.categories.map((key) => getCategory(key)))
    .filter((category): category is NonNullable<typeof category> => Boolean(category))
    .slice(0, 6);

  const homeCity = matchCity(`${input.city ?? ""} ${input.region ?? ""}`);
  const neighbours: Record<string, string[]> = {
    delhi: ["New Delhi", "Gurugram", "Noida"],
    gurgaon: ["Gurugram", "New Delhi", "Noida"],
    noida: ["Noida", "New Delhi", "Gurugram"],
    mumbai: ["Mumbai"],
    bangalore: ["Bengaluru"],
  };
  const locations = homeCity
    ? (neighbours[homeCity.key] ?? [homeCity.name])
    : input.city
      ? [input.city]
      : CITIES.slice(0, 2).map((city) => city.name);

  const offeringNames = input.offerings.map((o) => o.name).slice(0, 3);
  const offerPhrase = offeringNames.length ? offeringNames.join(", ") : input.industry.toLowerCase();
  const audience = categories.map((category) => category.label.toLowerCase());
  const audiencePhrase = audience.length > 1 ? `${audience.slice(0, -1).join(", ")} and ${audience.at(-1)}` : (audience[0] ?? "businesses");
  const moq = input.offerings.find((o) => o.minOrderQuantity)?.minOrderQuantity;

  const mustHaves = [
    `Is a ${audience[0] ?? "business"} or similar business in ${locations[0] ?? "your target area"}`,
    "Has a reachable phone number or email",
  ];
  if (archetype === "packaging" && moq) mustHaves.push(`Volume that can justify a ${moq.toLocaleString("en-IN")}-unit minimum order`);
  if (archetype === "photography") mustHaves.push("Regularly hosts or organises events");
  if (archetype === "recruitment") mustHaves.push("Actively growing or hiring");

  const channels: Channel[] = archetype === "recruitment" || archetype === "software" ? ["EMAIL", "MANUAL_CALL"] : ["EMAIL", "WHATSAPP", "MANUAL_CALL"];

  return {
    summary: `${input.name} sells ${offerPhrase} (${input.industry}). Based on the profile, the strongest fit is ${audiencePhrase} in ${locations.join(", ")} that would benefit from ${categories[0]?.needs[0] ?? "the offer"}.`,
    idealCustomerProfile: {
      description: `Independent and multi-outlet ${audiencePhrase} in ${locations.join(", ")} with visible demand for ${offerPhrase}.`,
      companySizes: archetype === "recruitment" ? ["11–50 people", "51–250 people"] : ["1–10 locations", "Small to mid-sized teams"],
      mustHaves,
      niceToHaves: defaults.signals.slice(0, 3).map((key) => SIGNAL_CATALOG[key].label),
      disqualifiers: ["Already opted out of contact", "Outside the service area", "Closed or temporarily closed"],
    },
    targetIndustries: unique(categories.map((category) => category.industry)),
    targetCategories: categories.map((category) => category.key),
    buyerPersonas: defaults.persona,
    recommendedLocations: locations,
    leadKeywords: unique(categories.flatMap((category) => category.keywords.slice(0, 2))).slice(0, 12),
    buyingSignals: defaults.signals.map((key) => ({ key, label: SIGNAL_CATALOG[key].label, description: SIGNAL_CATALOG[key].description })),
    outreachAngle: `Lead with a specific observation about the prospect (e.g. ${SIGNAL_CATALOG[defaults.signals[0] ?? "growing"].label.toLowerCase()}), connect it to ${categories[0]?.needs[0] ?? "their goals"}, and offer a low-effort next step.`,
    valueProposition:
      input.description.split(/(?<=\.)\s/)[0]?.slice(0, 240) ?? `${input.name} helps ${audiencePhrase} with ${offerPhrase}.`,
    suggestedChannels: channels,
  };
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const businessUnderstandingAgent = defineAgent<BusinessUnderstandingInput, Icp>({
  name: "business_understanding",
  version: "v1",
  description: "Understands what a business sells and derives its ideal customer profile.",
  output: icpSchema,
  effort: "medium",
  maxTokens: 8000,
  cacheable: true,
  buildPrompt(input) {
    const categories = CATEGORIES.map((category) => `${category.key} (${category.label})`).join(", ");
    return {
      system: [
        "You are a B2B go-to-market strategist. Given a company's profile, you identify who is most likely to buy from it and how to approach them.",
        "Ground every statement in the profile provided. Do not invent customers, statistics, prices or claims about the company.",
        "Keep lists short and specific (3–8 items). Prefer concrete business categories over vague segments.",
        `For targetCategories, choose from these canonical keys where possible: ${categories}. You may add others as short lowercase keys.`,
        `For buyingSignals, prefer these keys where they fit: ${Object.keys(SIGNAL_CATALOG).join(", ")}.`,
      ].join("\n"),
      user: `Company profile (JSON):\n${JSON.stringify(input, null, 2)}\n\nProduce the ideal customer profile.`,
    };
  },
  mock: mockBusinessUnderstanding,
});
