import { describe, expect, it } from "vitest";
import { discoveryParseSchema, mockDiscoveryParse } from "./agents/discovery-parser";

const base = { icpCategories: ["restaurant"], icpLocations: ["Mumbai"], offerings: ["Custom paper cups"], defaultRadiusKm: 25 };

describe("discovery parser (mock)", () => {
  it("extracts categories, area, signals, criteria and offer", () => {
    const parsed = mockDiscoveryParse({ ...base, query: "Find cafés in South Delhi with 2+ locations that may need custom branded paper cups" });
    expect(() => discoveryParseSchema.parse(parsed)).not.toThrow();
    expect(parsed.categories).toContain("cafe");
    expect(parsed.locationLabel).toBe("South Delhi");
    expect(parsed.preferredSignals).toContain("multiple_locations");
    expect(parsed.criteria).toBe("with 2+ locations");
    expect(parsed.offer).toBe("custom branded paper cups");
  });

  it("reads an explicit radius", () => {
    expect(mockDiscoveryParse({ ...base, query: "bakeries within 15 km of Noida" }).radiusKm).toBe(15);
  });

  it("falls back to the ICP when the query is vague", () => {
    const parsed = mockDiscoveryParse({ ...base, query: "find me some buyers" });
    expect(parsed.categories).toEqual(["restaurant"]);
    expect(parsed.locationLabel).toBe("Mumbai");
  });
});
