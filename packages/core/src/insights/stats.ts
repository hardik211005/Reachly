/**
 * Small, dependency-free statistics for insights. Every insight states its sample sizes; these
 * helpers turn them into an honest confidence instead of a guess.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export interface ProportionTest {
  rateA: number;
  rateB: number;
  /** Relative difference of A over B (0.5 = 50% higher); null when B is 0. */
  lift: number | null;
  /** Two-sided p-value of the difference. */
  p: number;
  /** 1 − p, capped: how sure we are the rates really differ. */
  confidence: number;
}

/** Two-proportion z-test: is x1/n1 really different from x2/n2? */
export function compareProportions(x1: number, n1: number, x2: number, n2: number): ProportionTest | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const rateA = x1 / n1;
  const rateB = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { rateA, rateB, lift: rateB > 0 ? rateA / rateB - 1 : null, p: 1, confidence: 0 };
  const z = (rateA - rateB) / se;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { rateA, rateB, lift: rateB > 0 ? rateA / rateB - 1 : null, p, confidence: Math.min(0.99, 1 - p) };
}

/** Confidence for a descriptive share (e.g. "most losses are on price"): grows with evidence. */
export function coverageConfidence(evidence: number, target = 12): number {
  return Math.min(0.95, Math.round((evidence / target) * 100) / 100);
}

export function pct(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded}%`;
}
