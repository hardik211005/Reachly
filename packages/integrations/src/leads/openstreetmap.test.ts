import { describe, expect, it } from "vitest";
import { GENERIC_NAME, buildOverpassQuery, nominatimToElement, toRawBusiness } from "./openstreetmap";
import { isPrivateAddress, isPublicHttpUrl } from "./website-enrichment";

describe("OpenStreetMap provider", () => {
  it("builds an Overpass query from category tags around a point", () => {
    const query = buildOverpassQuery({ categories: ["cafe", "bakery"], keywords: [] }, { lat: 28.5494, lng: 77.2001 }, 3000, 20);
    expect(query).toContain('nwr["amenity"="cafe"]["name"](around:3000,28.54940,77.20010);');
    expect(query).toContain('nwr["shop"="bakery"]["name"]');
    expect(query).toMatch(/out center tags \d+;$/);
  });

  it("sanitises free-text terms before putting them in a regex", () => {
    const query = buildOverpassQuery({ categories: ['yoga"];out;("'], keywords: [] }, { lat: 1, lng: 2 }, 1000, 10);
    expect(query).not.toContain('"];out;("');
    expect(query).toContain('nwr["name"~"yogaout",i]');
  });

  it("maps OSM tags to a business with contact details and a source link", () => {
    const business = toRawBusiness(
      {
        type: "node",
        id: 42,
        lat: 28.55,
        lon: 77.19,
        tags: { name: "Oval Bean Café", amenity: "cafe", "addr:street": "Hauz Khas Village Road", "addr:suburb": "Hauz Khas", "addr:city": "New Delhi", "contact:phone": "+91 99110 67205;+91 11 1234", website: "ovalbean.example", opening_hours: "Mo-Su 09:00-23:00" },
      },
      null,
    );
    expect(business).toMatchObject({
      externalId: "osm:node/42",
      name: "Oval Bean Café",
      primaryCategory: "cafe",
      locality: "Hauz Khas",
      city: "New Delhi",
      phone: "+91 99110 67205",
      website: "https://ovalbean.example",
      businessStatus: "OPERATIONAL",
      sourceUrl: "https://www.openstreetmap.org/node/42",
    });
    expect(toRawBusiness({ type: "node", id: 1, lat: 1, lon: 1, tags: { amenity: "cafe" } }, null)).toBeNull();
  });

  it("reshapes Nominatim results into the same tags", () => {
    const element = nominatimToElement({
      osm_type: "way",
      osm_id: 7,
      lat: "18.52",
      lon: "73.85",
      name: "Regal Bakery",
      category: "shop",
      type: "bakery",
      address: { road: "FC Road", suburb: "Deccan Gymkhana", city: "Pune", postcode: "411004" },
      extratags: { phone: "02032510845" },
    });
    const business = toRawBusiness(element, null);
    expect(business).toMatchObject({ externalId: "osm:way/7", name: "Regal Bakery", primaryCategory: "bakery", locality: "Deccan Gymkhana", city: "Pune", phone: "02032510845" });
  });

  it("recognises generic names that aren't real leads", () => {
    expect(GENERIC_NAME.test("Bakery")).toBe(true);
    expect(GENERIC_NAME.test("The Cafe")).toBe(true);
    expect(GENERIC_NAME.test("Regal Bakery")).toBe(false);
  });
});

describe("website enrichment SSRF guard", () => {
  it("flags private and loopback addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses non-http, local and private URLs without a network lookup", async () => {
    expect(await isPublicHttpUrl(new URL("ftp://example.com"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://localhost:3000"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://127.0.0.1/admin"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://169.254.169.254/latest/meta-data"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://user:pass@93.184.216.34/"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("https://93.184.216.34/"))).toBe(true);
  });
});
