import { describe, expect, it } from "vitest";
import { haversineKm, matchArea, matchCategories, matchCity } from "./taxonomy";

describe("taxonomy", () => {
  it("maps free text to categories", () => {
    expect(matchCategories("Find coffee shops that need cups")[0]?.key).toBe("cafe");
    expect(matchCategories("cloud kitchens and bakeries").map((c) => c.key)).toEqual(expect.arrayContaining(["cloud_kitchen", "bakery"]));
    expect(matchCategories("quantum widgets")).toHaveLength(0);
  });

  it("finds cities and sub-areas", () => {
    const city = matchCity("cafes in South Delhi");
    expect(city?.key).toBe("delhi");
    expect(city && matchArea("cafes in South Delhi", city)?.localities).toContain("Hauz Khas");
    expect(matchCity("startups in Gurugram")?.key).toBe("gurgaon");
  });

  it("computes distances", () => {
    const delhi = { lat: 28.6139, lng: 77.209 };
    const gurgaon = { lat: 28.4595, lng: 77.0266 };
    expect(haversineKm(delhi, gurgaon)).toBeGreaterThan(20);
    expect(haversineKm(delhi, gurgaon)).toBeLessThan(30);
  });
});
