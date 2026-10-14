import { describe, expect, it } from "vitest";
import { mockBusinessUnderstanding } from "../ai/agents/business-understanding";
import { scoreLead, type ScorableLead, type ScoringContext } from "./scoring";

const icp = mockBusinessUnderstanding({
  name: "CupCraft",
  website: null,
  industry: "Packaging",
  description: "Custom printed paper cups for cafés and restaurants.",
  city: "New Delhi",
  region: "Delhi",
  country: "India",
  businessSize: "MEDIUM",
  pricingModel: null,
  targetIndustries: [],
  targetCustomerTypes: ["Cafés", "Restaurants"],
  offerings: [{ type: "PRODUCT", name: "Branded cups", description: null, unitPrice: 3.5, currency: "INR", minOrderQuantity: 5000 }],
});

const context: ScoringContext = {
  icp,
  target: {
    categories: ["cafe"],
    locations: [{ label: "South Delhi", city: "New Delhi", lat: 28.5468, lng: 77.2118 }],
    radiusKm: 10,
    preferredSignals: ["multiple_locations"],
    criteria: "2+ locations",
  },
  weights: {},
  rules: [],
  qualifiedThreshold: 65,
  highFitThreshold: 80,
};

const strongLead: ScorableLead = {
  name: "Brew Roasters",
  category: "cafe",
  industry: "Food & Beverage",
  city: "New Delhi",
  locality: "Hauz Khas",
  latitude: 28.5494,
  longitude: 77.2001,
  website: "https://brew.example",
  email: "hello@brew.example",
  phone: "+919876543210",
  socialProfiles: { instagram: "https://instagram.com/brew" },
  reviewCount: 420,
  rating: 4.6,
  locationsCount: 4,
  signals: [
    { key: "multiple_locations", label: "Multiple locations", weight: 0.9, evidence: "4 outlets listed", source: "test" },
    { key: "takeaway_delivery", label: "Takeaway & delivery", weight: 0.8, evidence: "Offers delivery", source: "test" },
  ],
  contacts: [{ name: "Aditi Sharma", email: "aditi@brew.example", phone: null }],
  doNotContact: false,
};

describe("lead scoring", () => {
  it("scores a strong fit highly and explains every factor", () => {
    const result = scoreLead(strongLead, context);
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.fitTier).toBe("HIGH");
    expect(result.qualification).toBe("QUALIFIED");
    expect(result.breakdown).toHaveLength(7);
    for (const factor of result.breakdown) {
      expect(factor.reasons.length).toBeGreaterThan(0);
      expect(factor.score).toBeGreaterThanOrEqual(0);
      expect(factor.score).toBeLessThanOrEqual(100);
    }
    const location = result.breakdown.find((factor) => factor.factor === "locationMatch");
    expect(location?.reasons[0]).toMatch(/km from South Delhi/);
  });

  it("penalises leads that miss the criteria and the area", () => {
    const weak = scoreLead(
      { ...strongLead, category: "gym", industry: "Health & Fitness", latitude: 19.07, longitude: 72.87, city: "Mumbai", locationsCount: 1, signals: [], email: null, contacts: [] },
      context,
    );
    expect(weak.total).toBeLessThan(50);
    expect(weak.qualification).toBe("UNQUALIFIED");
    const icpFactor = weak.breakdown.find((factor) => factor.factor === "icpMatch");
    expect(icpFactor?.reasons.join(" ")).toMatch(/Single location/);
  });

  it("zeroes do-not-contact leads", () => {
    const result = scoreLead({ ...strongLead, doNotContact: true }, context);
    expect(result.total).toBe(0);
    expect(result.qualification).toBe("UNQUALIFIED");
    expect(result.breakdown.find((factor) => factor.factor === "contactability")?.reasons).toContain("Marked do-not-contact");
  });

  it("applies user-defined rules transparently", () => {
    const withRule = scoreLead(strongLead, {
      ...context,
      rules: [{ field: "locality", operator: "eq", value: "Hauz Khas", points: -30, label: "Already served in Hauz Khas" }],
    });
    const base = scoreLead(strongLead, context);
    expect(withRule.total).toBe(Math.max(0, base.total - 30));
    expect(withRule.adjustments).toEqual([{ label: "Already served in Hauz Khas", points: -30 }]);
  });

  it("respects custom weights", () => {
    const contactHeavy = scoreLead({ ...strongLead, email: null, contacts: [], phone: null }, { ...context, weights: { contactability: 90, icpMatch: 5, industryMatch: 1, locationMatch: 1, sizeFit: 1, digitalPresence: 1, buyingSignals: 1 } });
    expect(contactHeavy.total).toBeLessThan(20);
  });
});

describe("chains and franchises", () => {
  const chainSignalEntry = { key: "chain_or_franchise", label: "Chain or franchise", weight: 1, evidence: "Recognised brand (Wikidata Q1)", source: "discovery" };
  const chainLead: ScorableLead = { ...strongLead, signals: [...strongLead.signals, chainSignalEntry] };

  it("scores chains normally under the neutral policy", () => {
    expect(scoreLead(chainLead, context).total).toBe(scoreLead(strongLead, context).total);
  });

  it("scores chains down and never qualifies them when the workspace avoids them", () => {
    const result = scoreLead(chainLead, { ...context, chainPolicy: "avoid" });
    expect(result.total).toBe(Math.max(0, scoreLead(strongLead, context).total - 30));
    expect(result.qualification).toBe("UNQUALIFIED");
    expect(result.disqualifiedBy).toMatch(/Chain/);
    expect(result.adjustments.some((item) => item.points === -30)).toBe(true);
  });

  it("scores chains up when the workspace prefers them", () => {
    expect(scoreLead(chainLead, { ...context, chainPolicy: "prefer" }).total).toBeGreaterThan(scoreLead(strongLead, context).total);
  });
});

describe("digital gap for sellers who fix weak online presence", () => {
  const agencyContext: ScoringContext = { ...context, icp: { ...icp, buyingSignals: [{ key: "no_social_presence", label: "No social presence", description: "They need social media help" }] } };
  const polished: ScorableLead = { ...strongLead, website: "https://polished.example", socialProfiles: { instagram: "x", facebook: "y", linkedin: "z" }, reviewCount: 400, rating: 4.6 };
  const bare: ScorableLead = { ...strongLead, website: null, socialProfiles: {}, reviewCount: 3, rating: null };
  const factor = (lead: ScorableLead, ctx: ScoringContext) => scoreLead(lead, ctx).breakdown.find((item) => item.factor === "digitalPresence");

  it("rewards presence for other sellers", () => {
    expect(factor(polished, context)?.score).toBeGreaterThan(factor(bare, context)?.score ?? 100);
    expect(factor(polished, context)?.label).toBe("Digital presence");
  });

  it("rewards the gap — weak presence is the opportunity — and says so", () => {
    expect(factor(bare, agencyContext)?.score).toBeGreaterThan(factor(polished, agencyContext)?.score ?? 100);
    expect(factor(bare, agencyContext)?.label).toBe("Digital gap");
    expect(factor(bare, agencyContext)?.reasons[0]).toMatch(/room for your offer/);
  });
});

describe("reachability", () => {
  it("holds a lead with no phone or email at Needs review, however good the fit", () => {
    const unreachable: ScorableLead = { ...strongLead, email: null, phone: null, contacts: [] };
    const result = scoreLead(unreachable, { ...context, qualifiedThreshold: 1 });
    expect(result.qualification).toBe("NEEDS_REVIEW");
    expect(result.reviewReason).toMatch(/find a contact/);
    expect(scoreLead(strongLead, { ...context, qualifiedThreshold: 1 }).qualification).toBe("QUALIFIED");
  });
});
