import { describe, expect, it } from "vitest";
import { usesOnlyKnownNumbers, type InsightWriterInput } from "../ai/agents/insights";
import { compareProportions, coverageConfidence, normalCdf, pct } from "./stats";

describe("insight statistics", () => {
  it("computes the standard normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("is confident about a large, well-sampled difference", () => {
    const test = compareProportions(30, 50, 10, 50)!;
    expect(test.rateA).toBe(0.6);
    expect(test.rateB).toBe(0.2);
    expect(test.lift).toBeCloseTo(2, 6);
    expect(test.p).toBeLessThan(0.001);
    // Never claims certainty.
    expect(test.confidence).toBe(0.99);
  });

  it("is not confident about small samples or equal rates", () => {
    expect(compareProportions(2, 4, 1, 4)!.confidence).toBeLessThan(0.7);
    expect(compareProportions(5, 20, 5, 20)!.confidence).toBeCloseTo(0, 6);
    expect(compareProportions(0, 10, 0, 10)).toMatchObject({ p: 1, confidence: 0, lift: null });
  });

  it("refuses empty groups", () => {
    expect(compareProportions(1, 0, 1, 10)).toBeNull();
    expect(compareProportions(1, 10, 0, 0)).toBeNull();
  });

  it("grows descriptive confidence with evidence and caps it", () => {
    expect(coverageConfidence(3)).toBe(0.25);
    expect(coverageConfidence(100)).toBe(0.95);
    expect(pct(0.625)).toBe("63%");
  });
});

describe("insight wording guard", () => {
  const input: InsightWriterInput = {
    business: "Pipeline Co",
    kind: "channel_comparison",
    facts: { rate: "70%", otherRate: "20%", n: 10, otherN: 10, value: "₹1,12,100" },
    draft: { title: "AI calls get more positive responses than email", body: "70% of leads contacted by AI calls responded positively, against 20% by email (10 and 10 leads, in the last 30 days)." },
  };

  it("accepts rewording that keeps to the supplied numbers", () => {
    expect(usesOnlyKnownNumbers("AI calls won 70% positive replies vs 20% for email across 10 leads each in 30 days.", input)).toBe(true);
    // Thousands separators don't matter.
    expect(usesOnlyKnownNumbers("A quote worth ₹112100 is waiting.", input)).toBe(true);
  });

  it("rejects any number that isn't in the facts", () => {
    expect(usesOnlyKnownNumbers("AI calls are 3.5x better than email.", input)).toBe(false);
    expect(usesOnlyKnownNumbers("70% vs 20% — expect 12 more meetings.", input)).toBe(false);
  });
});
