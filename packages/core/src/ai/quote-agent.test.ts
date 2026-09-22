import { describe, expect, it } from "vitest";
import { draftQuoteDeterministically, quantityFromText, type QuoteDraftInput } from "./agents/quote";

const offerings: QuoteDraftInput["offerings"] = [
  { id: "social", name: "Social media management", description: null, unit: "month", minOrderQuantity: null },
  { id: "web", name: "Website development", description: null, unit: "project", minOrderQuantity: null },
  { id: "cups", name: "Custom paper cups", description: null, unit: "cup", minOrderQuantity: 5000 },
];

function input(conversation: QuoteDraftInput["conversation"]): QuoteDraftInput {
  return { seller: { name: "Demo Agency" }, lead: { name: "Monsoon Cafe", category: "cafe", city: "Delhi", contactName: "Priya Sharma" }, offerings, conversation, dealTitle: null };
}

describe("quote draft agent (deterministic)", () => {
  it("reads quantities the way people write them", () => {
    expect(quantityFromText("we need 10,000 cups a month", "cup")).toBe(10_000);
    expect(quantityFromText("about 10k cups", "cup")).toBe(10_000);
    expect(quantityFromText("let's do 6 months", "month")).toBe(6);
    expect(quantityFromText("a 2 lakh cup run", "cup")).toBe(200_000);
    expect(quantityFromText("no numbers here", "month")).toBeNull();
  });

  it("drafts what the prospect asked for, with their quantity, and never a price", () => {
    const draft = draftQuoteDeterministically(input([
      { source: "email", direction: "OUTBOUND", text: "We build websites and run social media for cafés." },
      { source: "email", direction: "INBOUND", text: "Interested in social media for 6 months. Price?" },
    ]));
    expect(draft.items).toEqual([{ offeringId: "social", quantity: 6, reason: "Social media management came up in the conversation (6 months)." }]);
    expect(draft.questions).toEqual([]);
    expect(draft.introduction).toContain("Hi Priya");
    expect(JSON.stringify(draft)).not.toMatch(/₹|\$|price of/i);
  });

  it("falls back to the pitched service and asks to confirm scope and quantity", () => {
    const draft = draftQuoteDeterministically(input([
      { source: "email", direction: "OUTBOUND", text: "We design custom paper cups for cafés." },
      { source: "email", direction: "INBOUND", text: "Sounds good, tell me more." },
    ]));
    expect(draft.items).toMatchObject([{ offeringId: "cups", quantity: 5000 }]);
    expect(draft.items[0]?.reason).toMatch(/outreach offered/);
    expect(draft.questions).toHaveLength(2);
  });
});
