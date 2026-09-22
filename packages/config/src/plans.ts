import { z } from "zod";
import { AUTOMATION_MODES, CHANNELS, USAGE_METRICS, type UsageMetric } from "./domain";

/**
 * Plan configuration.
 *
 * These are the *defaults* that `npm run db:seed` / `plans:sync` write into the `Plan`
 * table. At runtime the server reads limits from the database, so operators can change a
 * plan's limits without touching application code. `null` means "unlimited".
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

export const DEFAULT_PLAN_KEY = "free";

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    key: "free",
    name: "Free",
    description: "Validate your outreach with manual review of every lead and message.",
    priceMonthly: 0,
    currency: "USD",
    highlighted: false,
    sortOrder: 0,
    limits: {
      usage: {
        LEAD_CREDITS: 100,
        AI_CREDITS: 200,
        EMAIL_SENDS: 200,
        WHATSAPP_MESSAGES: 0,
        VOICE_MINUTES: 0,
        WORKFLOW_EXECUTIONS: 0,
      },
      resources: {
        activeCampaigns: 1,
        members: 1,
        workflows: 0,
        discoveryResultsPerSearch: 25,
        savedSearches: 3,
      },
    },
    features: {
      automationModes: ["MANUAL"],
      channels: ["EMAIL", "MANUAL_CALL"],
      aiQualification: false,
      aiInsights: false,
      copilot: false,
      advancedAnalytics: false,
      workflows: false,
      n8n: false,
      crm: true,
      quotes: false,
      voiceAgent: false,
      apiAccess: false,
      outboundWebhooks: false,
      priorityProcessing: false,
      csvImport: true,
    },
  },
  {
    key: "pro",
    name: "Pro",
    description: "AI qualification, email + WhatsApp sequences, workflows and the full CRM.",
    priceMonthly: 7900,
    currency: "USD",
    priceMonthlyInr: 649900,
    highlighted: true,
    sortOrder: 1,
    stripePriceEnv: "STRIPE_PRICE_PRO_MONTHLY",
    limits: {
      usage: {
        LEAD_CREDITS: 2500,
        AI_CREDITS: 5000,
        EMAIL_SENDS: 5000,
        WHATSAPP_MESSAGES: 1000,
        VOICE_MINUTES: 60,
        WORKFLOW_EXECUTIONS: 2000,
      },
      resources: {
        activeCampaigns: 10,
        members: 3,
        workflows: 10,
        discoveryResultsPerSearch: 100,
        savedSearches: 25,
      },
    },
    features: {
      automationModes: ["MANUAL", "ASSISTED", "AUTOMATED"],
      channels: ["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"],
      aiQualification: true,
      aiInsights: true,
      copilot: true,
      advancedAnalytics: true,
      workflows: true,
      n8n: true,
      crm: true,
      quotes: true,
      voiceAgent: true,
      apiAccess: false,
      outboundWebhooks: false,
      priorityProcessing: false,
      csvImport: true,
    },
  },
  {
    key: "scale",
    name: "Scale",
    description: "Voice agents, advanced workflows, API access and team collaboration at volume.",
    priceMonthly: 29900,
    currency: "USD",
    priceMonthlyInr: 2499900,
    highlighted: false,
    sortOrder: 2,
    stripePriceEnv: "STRIPE_PRICE_SCALE_MONTHLY",
    limits: {
      usage: {
        LEAD_CREDITS: 20000,
        AI_CREDITS: 50000,
        EMAIL_SENDS: 50000,
        WHATSAPP_MESSAGES: 10000,
        VOICE_MINUTES: 1000,
        WORKFLOW_EXECUTIONS: 25000,
      },
      resources: {
        activeCampaigns: null,
        members: 25,
        workflows: null,
        discoveryResultsPerSearch: 250,
        savedSearches: null,
      },
    },
    features: {
      automationModes: ["MANUAL", "ASSISTED", "AUTOMATED"],
      channels: ["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"],
      aiQualification: true,
      aiInsights: true,
      copilot: true,
      advancedAnalytics: true,
      workflows: true,
      n8n: true,
      crm: true,
      quotes: true,
      voiceAgent: true,
      apiAccess: true,
      outboundWebhooks: true,
      priorityProcessing: true,
      csvImport: true,
    },
  },
];

export function getPlanDefinition(key: string): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((plan) => plan.key === key);
}

/**
 * How many AI credits one AI request consumes. Credits are a user-facing abstraction over
 * provider cost: 1 credit ≈ $0.001 of model spend, with a floor of 1 credit per request.
 */
export const AI_CREDIT_MICRO_USD = 1000;
export function aiCreditsForCost(costMicroUsd: number): number {
  return Math.max(1, Math.ceil(costMicroUsd / AI_CREDIT_MICRO_USD));
}
