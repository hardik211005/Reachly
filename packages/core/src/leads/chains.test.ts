import { describe, expect, it } from "vitest";
import { chainNameKey, chainSignal, countNames, isChainLead, isKnownChain, readChainOverrides } from "./chains";

describe("chain detection", () => {
  it("treats a Wikidata brand as the strongest evidence", () => {
    const signal = chainSignal({ name: "Cafe Coffee Day", brand: { name: "Cafe Coffee Day", wikidata: "Q5017235" }, sameNameOutlets: 0 });
    expect(signal?.weight).toBe(1);
    expect(signal?.evidence).toContain("Q5017235");
  });

  it("recognises several outlets sharing a name", () => {
    const signal = chainSignal({ name: "Tealogy Cafe", brand: null, sameNameOutlets: 2 });
    expect(signal?.evidence).toBe("3 outlets found with the name “Tealogy Cafe”");
  });

  it("leaves independent businesses alone", () => {
    expect(chainSignal({ name: "Oval Bean Café", brand: null, sameNameOutlets: 0 })).toBeNull();
  });

  it("matches branch names to the brand", () => {
    expect(chainNameKey("Domino's - Saket")).toBe(chainNameKey("Dominos"));
    expect(chainNameKey("Café Coffee Day (Hauz Khas)")).toBe("cafe coffee day");
    expect(countNames(["Chaayos", "Chaayos - CP", "Oval Bean"]).get("chaayos")).toBe(2);
  });

  it("reads the flag from stored signals", () => {
    expect(isChainLead([{ key: "chain_or_franchise" }])).toBe(true);
    expect(isChainLead([{ key: "few_reviews" }])).toBe(false);
    expect(isChainLead(null)).toBe(false);
  });
});

describe("more chain evidence", () => {
  it("knows well-known brands even without map tags", () => {
    expect(chainSignal({ name: "Castle's Barbeque", brand: null, sameNameOutlets: 0 })?.source).toBe("known-brands");
    expect(chainSignal({ name: "Burger Singh - Sector 29", brand: null, sameNameOutlets: 0 })?.evidence).toBe("Well-known chain or franchise brand");
    expect(isKnownChain("Oval Bean Café")).toBe(false);
  });

  it("uses website evidence found during enrichment", () => {
    const website = { key: "chain_or_franchise", label: "Chain or franchise", weight: 0.9, evidence: "Website mentions “franchise”", source: "website" };
    expect(chainSignal({ name: "Kuki Kathi Junction", brand: null, sameNameOutlets: 0, websiteSignal: website })).toEqual(website);
  });

  it("lets the team's own call beat every other signal", () => {
    const overrides = { chains: [chainNameKey("Got Tea")], independents: [chainNameKey("Cafe Coffee Day")] };
    expect(chainSignal({ name: "Got Tea", brand: null, sameNameOutlets: 0, overrides })?.evidence).toBe("Marked as a chain by your team");
    expect(chainSignal({ name: "Cafe Coffee Day", brand: { name: "Cafe Coffee Day", wikidata: "Q5017235" }, sameNameOutlets: 3, overrides })).toBeNull();
  });

  it("reads stored overrides defensively", () => {
    expect(readChainOverrides(null)).toEqual({ chains: [], independents: [] });
    expect(readChainOverrides({ chains: ["a", 1], independents: "x" })).toEqual({ chains: ["a"], independents: [] });
  });
});
