import { z } from "zod";
import { AUTOMATION_MODES, CHANNELS, USAGE_METRICS, type UsageMetric } from "./domain";

/**
 * Validation schemas for plan configuration. Kept apart from plans.ts so browser pages that only
 * read plan prices and limits don't download zod; server code imports these from
 * "@repo/config/plans-schema".
 */

export const planFeaturesSchema = z.object({
  automationModes: z.array(z.enum(AUTOMATION_MODES)),
  channels: z.array(z.enum(CHANNELS)),
  aiQualification: z.boolean(),
  aiInsights: z.boolean(),
  copilot: z.boolean(),
  advancedAnalytics: z.boolean(),
  workflows: z.boolean(),
  n8n: z.boolean(),
  crm: z.boolean(),
  quotes: z.boolean(),
  voiceAgent: z.boolean(),
  apiAccess: z.boolean(),
  outboundWebhooks: z.boolean(),
  priorityProcessing: z.boolean(),
  csvImport: z.boolean(),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;
export type PlanFeatureKey = keyof PlanFeatures;

const usageLimitsShape = Object.fromEntries(
  USAGE_METRICS.map((metric) => [metric, z.number().int().nonnegative().nullable()]),
) as Record<UsageMetric, z.ZodNullable<z.ZodNumber>>;

export const planLimitsSchema = z.object({
  /** Monthly metered allowances, reset at the start of each billing period. */
  usage: z.object(usageLimitsShape),
  /** Concurrent resource caps. */
  resources: z.object({
    activeCampaigns: z.number().int().nonnegative().nullable(),
    members: z.number().int().positive().nullable(),
    workflows: z.number().int().nonnegative().nullable(),
    discoveryResultsPerSearch: z.number().int().positive(),
    savedSearches: z.number().int().nonnegative().nullable(),
  }),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const planDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string(),
  description: z.string(),
  /** Monthly price in the smallest currency unit (cents/paise). */
  priceMonthly: z.number().int().nonnegative(),
  currency: z.string().length(3),
  highlighted: z.boolean().default(false),
  sortOrder: z.number().int(),
  limits: planLimitsSchema,
  features: planFeaturesSchema,
  /** Env var holding the Stripe price id for this plan, if it is purchasable. */
  stripePriceEnv: z.string().optional(),
  /** Monthly price in paise for UPI payments (Razorpay charges in INR). Unset = not sold over UPI. */
  priceMonthlyInr: z.number().int().positive().optional(),
});
export type PlanDefinition = z.infer<typeof planDefinitionSchema>;
