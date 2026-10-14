import { describe, expect, it } from "vitest";
import { icpSchema } from "../business/schemas";
import { customersFromDescription, mockBusinessUnderstanding } from "./agents/business-understanding";

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

describe("customers named in the description", () => {
  const targets = (industry: string, description: string) => customersFromDescription({ industry, description }).map((category) => category.key);

  it("reads who the business sells to, for any kind of business", () => {
    expect(targets("Bakery", "We bake custom cakes. We supply cafés and offer bulk orders for offices and events.")).toEqual(["cafe", "corporate_office", "event_venue"]);
    expect(targets("Water purifiers", "Installation and AMC for offices, schools and hospitals.")).toEqual(["corporate_office", "school", "hospital"]);
    expect(targets("Auto parts", "Wholesale spare parts supplier to car workshops and dealerships.")).toEqual(["auto_service", "car_dealer"]);
  });

  it("never targets the seller's own kind of business", () => {
    expect(targets("Bakery", "A bakery for cafés and other bakeries.")).not.toContain("bakery");
  });

  it("treats equipment and software sellers as selling to the industry they name", () => {
    expect(targets("Gym equipment", "We sell and service commercial equipment.")).toEqual(["gym"]);
    expect(targets("Pharmacy software", "Billing made simple.")).toEqual(["pharmacy"]);
  });
});
