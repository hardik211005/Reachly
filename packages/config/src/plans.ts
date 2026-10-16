import type { PlanDefinition } from "./plans-schema";
import type { UsageMetric } from "./domain";

export type { PlanDefinition, PlanFeatureKey, PlanFeatures, PlanLimits } from "./plans-schema";

/**
 * Plan configuration.
 *
 * These are the *defaults* that `npm run db:seed` / `plans:sync` write into the `Plan`
 * table. At runtime the server reads limits from the database, so operators can change a
 * plan's limits without touching application code. `null` means "unlimited".
 */

export const DEFAULT_PLAN_KEY = "free";

/** New businesses try this plan free for this many days (no card), then drop to Free unless they pay. 0 = no trial. */
export const TRIAL = { planKey: "pro", days: 14 } as const;

/**
 * Credit top-ups, bought on top of the plan's monthly allowance. They never expire and are used
 * only once the monthly allowance runs out. Prices are in paise (INR), charged through Razorpay.
 */
export const CREDIT_PACKS = [
  {
    key: "leads-500",
    metric: "LEAD_CREDITS",
    amount: 500,
    name: "500 extra leads",
    description: "Find and add 500 more businesses.",
    priceInr: 49900,
  },
  {
    key: "ai-2000",
    metric: "AI_CREDITS",
    amount: 2000,
    name: "2,000 AI credits",
    description: "More AI-written messages, scoring and replies.",
    priceInr: 29900,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  metric: UsageMetric;
  amount: number;
  name: string;
  description: string;
  priceInr: number;
}>;
export type CreditPack = (typeof CREDIT_PACKS)[number];

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
    priceMonthly: 1200,
    currency: "USD",
    priceMonthlyInr: 99900,
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
    priceMonthly: 3600,
    currency: "USD",
    priceMonthlyInr: 299900,
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
