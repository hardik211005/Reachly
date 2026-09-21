/**
 * Model catalogue used for model selection, fallbacks and cost accounting.
 *
 * Prices are USD per 1M tokens. Provider prices change — verify against each provider's
 * pricing page before relying on cost reports, and override at runtime with the
 * AI_PRICING_OVERRIDES env var (JSON: {"model-id": {"input": 1.0, "output": 2.0}}).
 */

export const AI_PROVIDERS = ["mock", "openai", "anthropic", "google"] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

export interface ModelInfo {
  id: string;
  provider: AIProviderName;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsJsonSchema: boolean;
}

export const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic (per-token pricing from Anthropic's published rates)
  {
    id: "claude-opus-5",
    provider: "anthropic",
    label: "Claude Opus 5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    contextWindow: 200_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  // OpenAI
  {
    id: "gpt-5",
    provider: "openai",
    label: "GPT-5",
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    contextWindow: 400_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    label: "GPT-5 mini",
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    contextWindow: 400_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  // Google
  {
    id: "gemini-2.5-pro",
    provider: "google",
    label: "Gemini 2.5 Pro",
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
  // Deterministic local provider — no network, no cost.
  {
    id: "mock-1",
    provider: "mock",
    label: "Mock (demo mode)",
    inputPerMTok: 0,
    outputPerMTok: 0,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJsonSchema: true,
  },
];

/** Default model per provider when AI_DEFAULT_MODEL is not set. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderName, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5",
  google: "gemini-2.5-pro",
  mock: "mock-1",
};

/** Default fallback model per provider (used after retries on the primary are exhausted). */
export const FALLBACK_MODEL_BY_PROVIDER: Record<AIProviderName, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5-mini",
  google: "gemini-2.5-flash",
  mock: "mock-1",
};

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((model) => model.id === modelId);
}

export type PricingOverrides = Record<string, { input: number; output: number }>;

/** Cost of a request in micro-USD (1e-6 USD), integer to avoid float drift in aggregates. */
export function estimateCostMicroUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  overrides: PricingOverrides = {},
): number {
  const override = overrides[modelId];
  const info = getModelInfo(modelId);
  const inputRate = override?.input ?? info?.inputPerMTok ?? 0;
  const outputRate = override?.output ?? info?.outputPerMTok ?? 0;
  // $ per 1M tokens == micro-USD per token.
  return Math.round(inputTokens * inputRate + outputTokens * outputRate);
}
