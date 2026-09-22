import { z } from "zod";
import { firstName } from "../../shared/text";
import { defineAgent } from "../agent";

/**
 * quote_draft — proposes WHAT goes on a quote (catalog items and quantities, from what the
 * prospect said) and a short cover note. It never sees or produces prices: the pricing engine
 * prices every line from the catalog, and a person reviews the draft before it is sent.
 */

export const quoteDraftSchema = z.object({
  title: z.string().describe("Short quote title, e.g. 'Social media + Local SEO for Monsoon Cafe'."),
  items: z
    .array(
      z.object({
        offeringId: z.string().describe("Exactly one of the offering ids provided."),
        quantity: z.number().int().describe("Quantity in the offering's unit, from the conversation when stated."),
        reason: z.string().describe("Why this item, citing what the prospect said."),
      }),
    )
    .describe("One to four items, only from the offerings list."),
  introduction: z.string().describe("Two or three sentence cover note to the prospect. No prices."),
  questions: z.array(z.string()).describe("Details to confirm with the prospect before sending (quantities, scope, dates)."),
});
export type QuoteDraft = z.infer<typeof quoteDraftSchema>;

export interface QuoteDraftInput {
  seller: { name: string };
  lead: { name: string; category: string | null; city: string | null; contactName: string | null };
  offerings: Array<{ id: string; name: string; description: string | null; unit: string; minOrderQuantity: number | null }>;
  /** Recent conversation (messages, call summaries, notes), oldest first. */
  conversation: Array<{ source: string; direction: "INBOUND" | "OUTBOUND" | "NOTE"; text: string }>;
  dealTitle: string | null;
}

const STOP_WORDS = new Set(["management", "development", "service", "services", "package", "bundle", "custom", "starter", "monthly", "with", "and", "the", "for"]);

function keywords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function unitPattern(unit: string): string {
  const base = unit.toLowerCase().replace(/s$/, "");
  const synonyms: Record<string, string[]> = { month: ["month", "mo"], project: ["project"], unit: ["unit", "piece", "pc"], cup: ["cup"], box: ["box", "boxe"] };
  return (synonyms[base] ?? [base]).map((word) => `${word}(?:e?s)?`).join("|");
}

/** "10,000 cups", "10k cups", "6 months" → quantity for an offering's unit, if the prospect said one. */
export function quantityFromText(text: string, unit: string): number | null {
  const pattern = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|thousand|lakh)?\\s*(?:${unitPattern(unit)})\\b`, "i");
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const base = Number(match[1].replace(/,/g, ""));
  const multiplier = match[2] ? { k: 1000, thousand: 1000, lakh: 100_000 }[match[2].toLowerCase() as "k" | "thousand" | "lakh"] : 1;
  const value = Math.round(base * multiplier);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Deterministic draft grounded in the conversation — used in demo mode and when AI is unavailable. */
export function draftQuoteDeterministically(input: QuoteDraftInput): QuoteDraft {
  const said = input.conversation
    .filter((entry) => entry.direction !== "OUTBOUND")
    .map((entry) => entry.text)
    .join("\n");
  const pitched = input.conversation
    .filter((entry) => entry.direction === "OUTBOUND")
    .map((entry) => entry.text)
    .join("\n");

  const match = (text: string, limit: number) => {
    const haystack = text.toLowerCase();
    return input.offerings
      .map((offering) => {
        const words = keywords(offering.name);
        const hits = words.filter((word) => haystack.includes(word)).length;
        return { offering, score: words.length ? hits / words.length : 0 };
      })
      .filter((entry) => entry.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
  // What the prospect asked for wins; otherwise the one service we pitched them.
  const fromProspect = match(said, 3);
  const scored = fromProspect.length ? fromProspect : match(pitched, 1);

  const chosen = scored.length ? scored.map((entry) => entry.offering) : input.offerings.slice(0, 1);
  const questions: string[] = [];
  const items = chosen.map((offering) => {
    const stated = quantityFromText(said, offering.unit);
    const quantity = stated ?? offering.minOrderQuantity ?? 1;
    if (!stated) questions.push(`Confirm the ${offering.unit === "month" ? "number of months" : `quantity (${offering.unit})`} for ${offering.name}.`);
    const requested = fromProspect.some((entry) => entry.offering.id === offering.id);
    const wasPitched = !requested && scored.some((entry) => entry.offering.id === offering.id);
    return {
      offeringId: offering.id,
      quantity,
      reason: requested
        ? `${offering.name} came up in the conversation${stated ? ` (${stated} ${offering.unit}${stated === 1 ? "" : "s"})` : ""}.`
        : wasPitched
          ? `${offering.name} is what your outreach offered; they haven't named a service yet.`
          : `Closest match in your catalog for ${input.lead.name}; nothing specific was requested yet.`,
    };
  });
  if (!fromProspect.length) questions.push("They haven't asked for anything specific yet — check the scope before sending.");

  const first = firstName(input.lead.contactName);
  const names = chosen.map((offering) => offering.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "our services");
  return {
    title: `${names.slice(0, 2).join(" + ") || "Proposal"} for ${input.lead.name}`,
    items,
    introduction: `${first ? `Hi ${first}, thanks` : "Thanks"} for your time. As discussed, here is our proposal for ${list} for ${input.lead.name}. Happy to adjust the scope — just reply to this email or accept online when you're ready.`,
    questions,
  };
}

export const quoteDraftAgent = defineAgent<QuoteDraftInput, QuoteDraft>({
  name: "quote_draft",
  version: "v1",
  description: "Chooses catalog items and quantities for a quote from the conversation, and writes a cover note. Never produces prices.",
  output: quoteDraftSchema,
  effort: "low",
  maxTokens: 1500,
  cacheable: true,
  buildPrompt(input) {
    return {
      system: [
        `You draft quotes for ${input.seller.name}. You choose which catalog offerings belong on the quote and in what quantity, and write a short cover note.`,
        "Rules:",
        "- Only use offering ids from the list. Never invent products, services or prices. Do not mention any price or amount of money anywhere.",
        "- Take quantities from what the prospect said (e.g. '10,000 cups', '6 months'). If no quantity was stated, use the offering's minimum order quantity or 1, and add a question asking to confirm it.",
        "- Prefer fewer, clearly relevant items (one to four).",
        "- The cover note is two or three sentences, warm and specific to the prospect, and does not repeat line items.",
      ].join("\n"),
      user: JSON.stringify({ prospect: input.lead, deal: input.dealTitle, offerings: input.offerings, conversation: input.conversation }, null, 2),
    };
  },
  mock: draftQuoteDeterministically,
});
