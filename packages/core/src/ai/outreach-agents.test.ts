import { describe, expect, it } from "vitest";
import { analyzeConversationDeterministically } from "./agents/conversation-analysis";
import { composeOutreachMessage, composePitchPack, shortOffer, type OutreachLeadContext, type OutreachSellerContext } from "./agents/outreach";

const lead: OutreachLeadContext = {
  name: "Monsoon Café",
  category: "cafe",
  locality: "Hauz Khas",
  city: "New Delhi",
  description: null,
  services: [],
  rating: 4.6,
  reviewCount: 812,
  locationsCount: 3,
  signals: [{ key: "multiple_locations", label: "Multiple locations", evidence: "3 outlets listed" }],
  contactName: "Priya Sethi",
  contactTitle: "Owner",
};

const seller: OutreachSellerContext = {
  businessName: "Demo Growth Agency",
  senderName: "Aarav",
  description: "Growth agency for local businesses.",
  valueProposition: null,
  offer: "Social media management for cafés: 12 posts and 8 reels a month.",
  pitchAngle: null,
  pricingFacts: [],
};

function analyze(text: string, optOutKeywords = ["stop", "unsubscribe", "remove me", "not interested"]) {
  return analyzeConversationDeterministically({
    channel: "EMAIL",
    leadName: "Monsoon Café",
    sellerName: "Demo Growth Agency",
    offer: "social media",
    messages: [
      { direction: "OUTBOUND", body: "Hi Priya, quick idea…" },
      { direction: "INBOUND", body: text },
    ],
    optOutKeywords,
    pricingFacts: [],
  });
}

describe("reply classification (deterministic safety net)", () => {
  it.each([
    ["Please remove me from your list.", "OPT_OUT"],
    ["Not interested, thanks", "OPT_OUT"],
    ["Would Thursday afternoon work for a quick call?", "MEETING_REQUEST"],
    ["What would this cost for two outlets?", "PRICING_REQUEST"],
    ["Busy until after Diwali, maybe next month", "NOT_NOW"],
    ["We're all set on this, thank you.", "NEGATIVE"],
    ["Sounds interesting, tell me more", "POSITIVE"],
    ["I'm out of office until Monday", "OUT_OF_OFFICE"],
    ["Do you work with other cafés nearby?", "QUESTION"],
  ])("%s → %s", (text, intent) => {
    expect(analyze(text).intent).toBe(intent);
  });

  it("never drafts a reply to an opt-out", () => {
    const result = analyze("STOP");
    expect(result.optOut).toBe(true);
    expect(result.suggestedReply).toBeNull();
  });

  it("does not invent prices when none are configured", () => {
    const result = analyze("How much does it cost?");
    expect(result.suggestedReply).not.toMatch(/₹|\$|\d{3,}/);
  });
});

describe("message composition", () => {
  it("turns an offer sentence into a phrase that reads mid-sentence", () => {
    expect(shortOffer("Social media management for cafés: 12 posts and 8 reels a month.")).toBe("social media management for cafés");
    expect(shortOffer("Conversion-focused websites for startups, live in four weeks.")).toBe("conversion-focused websites for startups");
    expect(shortOffer("Meta and Google ads management for D2C brands, with weekly reporting.")).toBe("Meta and Google ads management for D2C brands");
  });

  it("personalises from real lead data and fills every variable", () => {
    const message = composeOutreachMessage({
      channel: "EMAIL",
      stepName: "Opener",
      stepOrder: 0,
      template: { subject: "Quick idea for {{business_name}}", body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}" },
      tone: "friendly",
      lead,
      seller,
      previousMessages: [],
    });
    expect(message.subject).toBe("Quick idea for Monsoon Café");
    expect(message.body).toContain("Hi Priya,");
    expect(message.body).toContain("3 outlets");
    expect(message.body).not.toMatch(/\{\{|\}\}/);
    expect(message.personalization).toContain("3 locations");
  });

  it("only quotes prices that come from configured offerings", () => {
    const withoutPricing = composePitchPack({ tone: "friendly", lead, seller });
    expect(JSON.stringify(withoutPricing)).not.toMatch(/₹/);
    const withPricing = composePitchPack({ tone: "friendly", lead, seller: { ...seller, pricingFacts: ["Social media management: ₹35,000 per month"] } });
    expect(withPricing.objections.find((item) => item.objection.includes("cost"))?.response).toContain("₹35,000");
  });

  it("uses plain text without subjects on WhatsApp", () => {
    const message = composeOutreachMessage({
      channel: "WHATSAPP",
      stepName: "Nudge",
      stepOrder: 1,
      template: { subject: "ignored", body: "Hi {{first_name}}, {{follow_up_hook}}" },
      tone: "friendly",
      lead,
      seller,
      previousMessages: [],
    });
    expect(message.subject).toBeNull();
    expect(message.body).toBe("Hi Priya, I'd be happy to share how we'd approach social media management for cafés for Monsoon Café specifically");
  });
});
