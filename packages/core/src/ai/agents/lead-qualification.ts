import { getCategory } from "@repo/config/taxonomy";
import { z } from "zod";
import { defineAgent } from "../agent";

export interface LeadQualificationInput {
  lead: {
    name: string;
    category: string | null;
    industry: string | null;
    locality: string | null;
    city: string | null;
    description: string | null;
    services: string[];
    locationsCount: number | null;
    reviewCount: number | null;
    rating: number | null;
    hasWebsite: boolean;
    hasEmail: boolean;
    signals: Array<{ key: string; evidence: string }>;
  };
  seller: {
    summary: string | null;
    offer: string | null;
    mustHaves: string[];
    disqualifiers: string[];
    buyingSignals: string[];
  };
  ruleFactors: Record<string, number>;
}

export const leadQualificationSchema = z.object({
  relevance: z.number().describe("0-100: how relevant the seller's offer is to this business."),
  buyingSignalScore: z.number().describe("0-100: strength of evidence that they need it now."),
  qualification: z.enum(["QUALIFIED", "NEEDS_REVIEW", "UNQUALIFIED"]),
  reasons: z.array(z.string()).describe("Short, specific reasons grounded in the lead data."),
  risks: z.array(z.string()),
  summary: z.string().describe("One or two sentences explaining the fit, for a salesperson."),
});
export type LeadQualification = z.infer<typeof leadQualificationSchema>;

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

/** Deterministic qualification derived from the same facts the rules use. */
export function mockLeadQualification(input: LeadQualificationInput): LeadQualification {
  const { lead, seller, ruleFactors } = input;
  const category = lead.category ? getCategory(lead.category) : undefined;
  const offer = (seller.offer ?? "").toLowerCase();
  const needMatch = category?.needs.find((need) => need.split(" ").some((word) => word.length > 4 && offer.includes(word)));
  const relevance = clamp((ruleFactors.icpMatch ?? 50) * 0.7 + (needMatch ? 30 : 10));
  const wanted = new Set(seller.buyingSignals.map((signal) => signal.toLowerCase()));
  const matchedSignals = lead.signals.filter((signal) => wanted.has(signal.key.toLowerCase()) || wanted.size === 0);
  const buyingSignalScore = clamp(matchedSignals.length ? 45 + matchedSignals.length * 15 : 20);

  const reasons: string[] = [];
  if (needMatch) reasons.push(`${category ? plural(category.label) : "Businesses like this"} typically need ${needMatch}, which matches your offer`);
  else if (category) reasons.push(`${category.label} is related to your target market`);
  for (const signal of matchedSignals.slice(0, 3)) reasons.push(signal.evidence);
  if ((lead.locationsCount ?? 1) > 1) reasons.push(`Operates ${lead.locationsCount} locations — larger volume`);

  const risks: string[] = [];
  if (!lead.hasEmail) risks.push("No email found — outreach limited to phone/WhatsApp");
  if ((lead.reviewCount ?? 0) < 20) risks.push("Small review footprint — may be very early-stage");
  if ((lead.locationsCount ?? 1) === 1 && offer.includes("5,000")) risks.push("Single outlet may not meet minimum order quantities");

  const combined = (relevance + buyingSignalScore) / 2;
  return {
    relevance,
    buyingSignalScore,
    qualification: combined >= 65 ? "QUALIFIED" : combined >= 45 ? "NEEDS_REVIEW" : "UNQUALIFIED",
    reasons: reasons.length ? reasons : ["Limited public information available"],
    risks,
    summary: `${lead.name} is a ${category?.label.toLowerCase() ?? lead.category ?? "business"}${lead.locality ? ` in ${lead.locality}` : ""}${
      matchedSignals.length ? ` showing ${matchedSignals.map((signal) => signal.key.replace(/_/g, " ")).slice(0, 2).join(" and ")}` : ""
    }. ${needMatch ? `Likely need: ${needMatch}.` : "Fit depends on confirming their needs."}`,
  };
}

export const leadQualificationAgent = defineAgent<LeadQualificationInput, LeadQualification>({
  name: "lead_qualification",
  version: "v2",
  description: "Assesses how well a discovered business fits the seller's offer and why.",
  output: leadQualificationSchema,
  effort: "low",
  maxTokens: 2000,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        "You qualify B2B leads for a seller. Judge only from the data provided; do not assume facts about the business.",
        "relevance = how useful the seller's offer is to this type of business. buyingSignalScore = evidence they need it now.",
        "Reasons and risks must each cite something concrete from the lead data. Keep them short.",
      ].join("\n"),
      user: JSON.stringify(input),
    };
  },
  mock: mockLeadQualification,
});
