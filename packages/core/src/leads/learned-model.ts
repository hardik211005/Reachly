import { z } from "zod";
import { SCORING_FACTORS, type ScoringFactor } from "./scoring-defaults";

/**
 * Learned conversion model. A small, explainable machine-learning layer over the transparent
 * rule factors: an L2-regularised logistic regression that learns, from this workspace's own
 * outcomes, how much each factor actually predicts a lead converting (interested, meeting, quote
 * or won) once contacted.
 *
 * It never replaces the rule score silently. It reports a conversion probability per lead, the
 * learned factor importance, cross-validated quality (AUC) and *suggested* weights that an admin
 * can choose to apply. Pure functions — no I/O — so it is deterministic and unit-testable.
 */

export interface TrainingSample {
  /** Rule factor scores, 0–100. */
  features: Record<ScoringFactor, number>;
  /** 1 = converted, 0 = contacted and did not convert. */
  label: 0 | 1;
}

export const learnedModelSchema = z.object({
  version: z.literal("logreg-v1"),
  trainedAt: z.string(),
  intercept: z.number(),
  /** Coefficients on standardised features (per standard deviation of the factor score). */
  coefficients: z.record(z.string(), z.number()),
  means: z.record(z.string(), z.number()),
  stds: z.record(z.string(), z.number()),
  metrics: z.object({
    samples: z.number().int(),
    positives: z.number().int(),
    baseRate: z.number(),
    /** Mean out-of-fold ROC AUC (0.5 = no better than chance). */
    auc: z.number().nullable(),
    folds: z.number().int(),
  }),
  /** Weights suggested from the learned importance, normalised to sum to 100. */
  suggestedWeights: z.record(z.string(), z.number()),
});
export type LearnedModel = z.infer<typeof learnedModelSchema>;

export const MODEL_MIN_SAMPLES = 30;
export const MODEL_MIN_PER_CLASS = 5;
/** Below this AUC the model is shown but its suggestions are flagged as unreliable. */
export const MODEL_USEFUL_AUC = 0.6;

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

interface Standardiser {
  means: Record<ScoringFactor, number>;
  stds: Record<ScoringFactor, number>;
}

function fitStandardiser(samples: TrainingSample[]): Standardiser {
  const means = {} as Record<ScoringFactor, number>;
  const stds = {} as Record<ScoringFactor, number>;
  for (const factor of SCORING_FACTORS) {
    const values = samples.map((sample) => sample.features[factor] ?? 0);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
    means[factor] = mean;
    // A constant factor carries no information; a unit std keeps it at zero after centring.
    stds[factor] = Math.sqrt(variance) || 1;
  }
  return { means, stds };
}

const vectorise = (features: Record<string, number>, scaler: Standardiser) => SCORING_FACTORS.map((factor) => ((features[factor] ?? 0) - scaler.means[factor]) / scaler.stds[factor]);

/** Batch gradient descent on the regularised log-loss. Classes are re-weighted so rare conversions still count. */
function fitLogistic(rows: number[][], labels: number[], options: { l2: number; iterations: number; learningRate: number }) {
  const dims = rows[0]?.length ?? 0;
  const weights = new Array<number>(dims).fill(0);
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  const positiveWeight = positives ? labels.length / (2 * positives) : 1;
  const negativeWeight = negatives ? labels.length / (2 * negatives) : 1;
  let bias = 0;

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const gradient = new Array<number>(dims).fill(0);
    let biasGradient = 0;
    for (let row = 0; row < rows.length; row++) {
      const x = rows[row] as number[];
      const y = labels[row] as number;
      const prediction = sigmoid(bias + x.reduce((sum, value, index) => sum + value * (weights[index] as number), 0));
      const error = (prediction - y) * (y === 1 ? positiveWeight : negativeWeight);
      for (let index = 0; index < dims; index++) gradient[index] = (gradient[index] as number) + error * (x[index] as number);
      biasGradient += error;
    }
    const n = Math.max(1, rows.length);
    for (let index = 0; index < dims; index++) weights[index] = (weights[index] as number) - options.learningRate * ((gradient[index] as number) / n + options.l2 * (weights[index] as number));
    bias -= options.learningRate * (biasGradient / n);
  }
  return { weights, bias };
}

/** ROC AUC via the rank-sum (Mann–Whitney U) formulation, with ties counted as half. */
export function rocAuc(scores: number[], labels: number[]): number | null {
  const pairs = scores.map((score, index) => ({ score, label: labels[index] as number })).sort((a, b) => a.score - b.score);
  const positives = pairs.filter((pair) => pair.label === 1).length;
  const negatives = pairs.length - positives;
  if (!positives || !negatives) return null;
  let rankSum = 0;
  let index = 0;
  while (index < pairs.length) {
    let end = index;
    while (end + 1 < pairs.length && (pairs[end + 1] as { score: number }).score === (pairs[index] as { score: number }).score) end++;
    const averageRank = (index + end) / 2 + 1;
    for (let tie = index; tie <= end; tie++) if ((pairs[tie] as { label: number }).label === 1) rankSum += averageRank;
    index = end + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Deterministic stratified fold assignment so retraining on the same data gives the same metrics. */
function stratifiedFolds(labels: number[], k: number): number[] {
  const folds = new Array<number>(labels.length).fill(0);
  let positive = 0;
  let negative = 0;
  labels.forEach((label, index) => {
    folds[index] = label === 1 ? positive++ % k : negative++ % k;
  });
  return folds;
}

export type TrainResult =
  | { status: "trained"; model: LearnedModel }
  | { status: "insufficient_data"; samples: number; positives: number; negatives: number; needed: { samples: number; perClass: number } };

const TRAIN_OPTIONS = { l2: 0.05, iterations: 600, learningRate: 0.3 };

export function trainConversionModel(samples: TrainingSample[], now: Date = new Date()): TrainResult {
  const positives = samples.filter((sample) => sample.label === 1).length;
  const negatives = samples.length - positives;
  if (samples.length < MODEL_MIN_SAMPLES || positives < MODEL_MIN_PER_CLASS || negatives < MODEL_MIN_PER_CLASS) {
    return { status: "insufficient_data", samples: samples.length, positives, negatives, needed: { samples: MODEL_MIN_SAMPLES, perClass: MODEL_MIN_PER_CLASS } };
  }
  const labels = samples.map((sample) => sample.label);

  // Out-of-fold evaluation: each fold is scored by a model that never saw it.
  const k = Math.min(5, positives, negatives);
  const folds = stratifiedFolds(labels, k);
  const oofScores = new Array<number>(samples.length).fill(0);
  for (let fold = 0; fold < k; fold++) {
    const trainIdx = samples.map((_, index) => index).filter((index) => folds[index] !== fold);
    const testIdx = samples.map((_, index) => index).filter((index) => folds[index] === fold);
    const scaler = fitStandardiser(trainIdx.map((index) => samples[index] as TrainingSample));
    const fitted = fitLogistic(
      trainIdx.map((index) => vectorise((samples[index] as TrainingSample).features, scaler)),
      trainIdx.map((index) => labels[index] as number),
      TRAIN_OPTIONS,
    );
    for (const index of testIdx) {
      const x = vectorise((samples[index] as TrainingSample).features, scaler);
      oofScores[index] = fitted.bias + x.reduce((sum, value, dim) => sum + value * (fitted.weights[dim] as number), 0);
    }
  }
  const auc = rocAuc(oofScores, labels);

  // Final model on all data.
  const scaler = fitStandardiser(samples);
  const fitted = fitLogistic(samples.map((sample) => vectorise(sample.features, scaler)), labels, TRAIN_OPTIONS);
  const coefficients = Object.fromEntries(SCORING_FACTORS.map((factor, index) => [factor, round(fitted.weights[index] as number, 4)]));

  return {
    status: "trained",
    model: {
      version: "logreg-v1",
      trainedAt: now.toISOString(),
      intercept: round(fitted.bias, 4),
      coefficients,
      means: Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, round(scaler.means[factor], 3)])),
      stds: Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, round(scaler.stds[factor], 3)])),
      metrics: { samples: samples.length, positives, baseRate: round(positives / samples.length, 4), auc: auc === null ? null : round(auc, 3), folds: k },
      suggestedWeights: suggestWeights(coefficients),
    },
  };
}

/**
 * Turns learned importance into rule weights that sum to 100. Factors that don't help (zero or
 * negative coefficient) keep a small floor rather than vanishing, so the rule score stays
 * well-rounded and no factor is dropped on thin evidence.
 */
export function suggestWeights(coefficients: Record<string, number>): Record<ScoringFactor, number> {
  const FLOOR = 3;
  const positive = SCORING_FACTORS.map((factor) => Math.max(0, coefficients[factor] ?? 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total === 0) return Object.fromEntries(SCORING_FACTORS.map((factor) => [factor, Math.round(100 / SCORING_FACTORS.length)])) as Record<ScoringFactor, number>;
  const budget = 100 - FLOOR * SCORING_FACTORS.length;
  const raw = positive.map((value) => FLOOR + (value / total) * budget);
  const rounded = raw.map((value) => Math.round(value));
  // Fix rounding drift on the largest weight so the total is exactly 100.
  const drift = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const largest = rounded.indexOf(Math.max(...rounded));
  rounded[largest] = (rounded[largest] as number) + drift;
  return Object.fromEntries(SCORING_FACTORS.map((factor, index) => [factor, rounded[index] as number])) as Record<ScoringFactor, number>;
}

export interface Prediction {
  probability: number;
  /** Factors pushing this lead's probability up or down the most, in log-odds. */
  drivers: Array<{ factor: ScoringFactor; effect: number }>;
}

export function predictConversion(model: LearnedModel, features: Record<string, number>): Prediction {
  const contributions = SCORING_FACTORS.map((factor) => {
    const std = model.stds[factor] || 1;
    const z = ((features[factor] ?? 0) - (model.means[factor] ?? 0)) / std;
    return { factor, effect: round(z * (model.coefficients[factor] ?? 0), 3) };
  });
  const logit = model.intercept + contributions.reduce((sum, item) => sum + item.effect, 0);
  // Training re-balanced the classes, which centres the intercept near 50%; shift it back to the
  // workspace's real conversion rate so the probability is calibrated to reality.
  const base = Math.min(0.99, Math.max(0.01, model.metrics.baseRate));
  const calibrated = sigmoid(logit + Math.log(base / (1 - base)));
  return {
    probability: round(calibrated, 4),
    drivers: contributions.filter((item) => Math.abs(item.effect) >= 0.05).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 3),
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
