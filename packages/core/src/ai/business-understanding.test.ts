import { describe, expect, it } from "vitest";
import { icpSchema } from "../business/schemas";
import { mockBusinessUnderstanding } from "./agents/business-understanding";

describe("business understanding (mock)", () => {
  it("produces a schema-valid ICP grounded in the profile", () => {
    const icp = mockBusinessUnderstanding({
      name: "LensCraft Studio",
      website: null,
      industry: "Photography",
      description: "Wedding and corporate event photography and videography.",
      city: "Gurugram",
      region: "Haryana",
      country: "India",
      businessSize: "SMALL",
      pricingModel: null,
      targetIndustries: [],
      targetCustomerTypes: [],
      offerings: [{ type: "SERVICE", name: "Wedding photography", description: null, unitPrice: null, currency: "INR", minOrderQuantity: null }],
    });
    expect(() => icpSchema.parse(icp)).not.toThrow();
    expect(icp.targetCategories).toEqual(expect.arrayContaining(["event_venue", "wedding_planner"]));
    expect(icp.recommendedLocations[0]).toBe("Gurugram");
    expect(icp.buyingSignals.map((signal) => signal.key)).toContain("hosts_events");
  });

  it("prefers the categories the user stated", () => {
    const icp = mockBusinessUnderstanding({
      name: "BoxWorks",
      website: null,
      industry: "Packaging",
      description: "Custom boxes and food packaging.",
      city: null,
      region: null,
      country: null,
      businessSize: "SMALL",
      pricingModel: null,
      targetIndustries: [],
      targetCustomerTypes: ["Bakeries", "D2C brands"],
      offerings: [],
    });
    expect(icp.targetCategories.slice(0, 2)).toEqual(["bakery", "d2c_brand"]);
  });
});
