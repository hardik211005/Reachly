import { describe, expect, it } from "vitest";
import { predictConversion, rocAuc, suggestWeights, trainConversionModel, type TrainingSample } from "./learned-model";
import { SCORING_FACTORS, type ScoringFactor } from "./scoring-defaults";

/** Deterministic pseudo-random numbers (mulberry32) so tests never flake. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Conversion depends on contactability and buying signals only; the other factors are noise. */
function syntheticSamples(count: number, seed = 7): TrainingSample[] {
  const random = rng(seed);
  return Array.from({ length: count }, () => {
    const features = Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, Math.round(random() * 100)])) as Record<ScoringFactor, number>;
    const logit = -4 + 0.045 * features.contactability + 0.03 * features.buyingSignals;
    const label = random() < 1 / (1 + Math.exp(-logit)) ? 1 : 0;
    return { features, label: label as 0 | 1 };
  });
}

describe("rocAuc", () => {
  it("is 1 for a perfect ranking, 0.5 for ties and null without both classes", () => {
    expect(rocAuc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(rocAuc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(rocAuc([0.3, 0.4], [1, 1])).toBeNull();
  });
});

describe("trainConversionModel", () => {
  it("refuses to train on too little data and says what is needed", () => {
    const result = trainConversionModel(syntheticSamples(12));
    expect(result.status).toBe("insufficient_data");
    if (result.status === "insufficient_data") expect(result.needed.samples).toBeGreaterThan(12);
  });

  it("learns which factors actually predict conversion", () => {
    const result = trainConversionModel(syntheticSamples(400));
    expect(result.status).toBe("trained");
    if (result.status !== "trained") return;
    const { coefficients, metrics, suggestedWeights } = result.model;
    expect(metrics.auc).toBeGreaterThan(0.7);
    // The two real drivers outrank every noise factor.
    const noise = SCORING_FACTORS.filter((factor) => factor !== "contactability" && factor !== "buyingSignals");
    for (const factor of noise) {
      expect(coefficients.contactability ?? 0).toBeGreaterThan(Math.abs(coefficients[factor] ?? 0));
      expect(coefficients.buyingSignals ?? 0).toBeGreaterThan(Math.abs(coefficients[factor] ?? 0));
    }
    expect(Object.values(suggestedWeights).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(suggestedWeights.contactability ?? 0).toBeGreaterThan(suggestedWeights.locationMatch ?? 0);
  });

  it("is deterministic for the same data", () => {
    const samples = syntheticSamples(120);
    const a = trainConversionModel(samples, new Date(0));
    const b = trainConversionModel(samples, new Date(0));
    expect(a).toEqual(b);
  });
});

describe("predictConversion", () => {
  it("ranks a strong lead above a weak one and stays near the base rate on average", () => {
    const samples = syntheticSamples(400);
    const result = trainConversionModel(samples);
    if (result.status !== "trained") throw new Error("expected a trained model");
    const base = Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, 50]));
    const strong = predictConversion(result.model, { ...base, contactability: 100, buyingSignals: 100 });
    const weak = predictConversion(result.model, { ...base, contactability: 0, buyingSignals: 0 });
    expect(strong.probability).toBeGreaterThan(weak.probability);
    expect(strong.drivers[0]?.factor).toMatch(/contactability|buyingSignals/);

    const mean = samples.reduce((sum, sample) => sum + predictConversion(result.model, sample.features).probability, 0) / samples.length;
    expect(Math.abs(mean - result.model.metrics.baseRate)).toBeLessThan(0.12);
  });
});

describe("suggestWeights", () => {
  it("keeps a floor for unhelpful factors and sums to 100", () => {
    const weights = suggestWeights({ icpMatch: 2, contactability: 1, locationMatch: -1 });
    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(weights.locationMatch).toBeGreaterThanOrEqual(3);
    expect(weights.icpMatch).toBeGreaterThan(weights.contactability);
  });
});
