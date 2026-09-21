import { describe, expect, it } from "vitest";
import { dedupeKeyFor, normalizeDomain, normalizeEmail, normalizePhone, normalizeRawBusiness } from "./normalize";

describe("normalisation", () => {
  it("normalises domains", () => {
    expect(normalizeDomain("https://www.Example.com/about")).toBe("example.com");
    expect(normalizeDomain("example.in")).toBe("example.in");
    expect(normalizeDomain("not a url")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });

  it("normalises phone numbers to E.164", () => {
    expect(normalizePhone("098765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("0044 20 7946 0000")).toBe("+442079460000");
    expect(normalizePhone("20 7946 0000", "United Kingdom")).toBe("+442079460000");
    expect(normalizePhone("123")).toBeNull();
  });

  it("validates emails", () => {
    expect(normalizeEmail(" Hello@Cafe.Example ")).toBe("hello@cafe.example");
    expect(normalizeEmail("nope")).toBeNull();
  });

  it("builds dedupe keys by priority: domain, phone, name+city", () => {
    expect(dedupeKeyFor({ website: "https://www.brew.example", phone: "+919876543210", name: "Brew" })).toBe("domain:brew.example");
    expect(dedupeKeyFor({ phone: "098765 43210", name: "Brew" })).toBe("phone:+919876543210");
    expect(dedupeKeyFor({ name: "Brew Café", city: "New Delhi" })).toBe("name:brew-cafe|new-delhi");
  });

  it("maps provider categories onto the taxonomy", () => {
    const candidate = normalizeRawBusiness({
      externalId: "x1",
      name: "  Blue  Door Coffee ",
      categories: ["coffee_shop", "cafe"],
      primaryCategory: "coffee_shop",
      address: null,
      locality: null,
      city: "Pune",
      region: null,
      country: "India",
      postalCode: null,
      lat: null,
      lng: null,
      phone: "020 1234 5678",
      website: null,
      email: null,
      rating: null,
      reviewCount: null,
      priceLevel: null,
      openingHours: null,
      businessStatus: "CLOSED_PERMANENTLY",
      sourceUrl: null,
      raw: {},
    });
    expect(candidate.name).toBe("Blue Door Coffee");
    expect(candidate.category).toBe("cafe");
    expect(candidate.industry).toBe("Food & Beverage");
    expect(candidate.dedupeKey).toBe("phone:+912012345678");
    expect(candidate.closed).toBe(true);
  });
});
