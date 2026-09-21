import {
  DEFAULT_PLAN_KEY,
  PLAN_DEFINITIONS,
  planFeaturesSchema,
  planLimitsSchema,
  type PlanFeatureKey,
  type PlanFeatures,
  type PlanLimits,
} from "@repo/config";
import { prisma, type Plan, type PrismaClient, type Subscription } from "@repo/db";
import type { TenantContext } from "../context";
import { FeatureNotInPlanError, LimitExceededError, NotFoundError } from "../errors";

export interface ResolvedPlan {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  features: PlanFeatures;
  subscription: Subscription;
}

/** Writes the plan definitions from @repo/config into the Plan table (idempotent). */
export async function syncPlans(client: PrismaClient = prisma): Promise<void> {
  for (const definition of PLAN_DEFINITIONS) {
    const stripePriceId = definition.stripePriceEnv ? process.env[definition.stripePriceEnv] || null : null;
    await client.plan.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        priceMonthly: definition.priceMonthly,
        currency: definition.currency,
        stripePriceId,
        limits: definition.limits,
        features: definition.features,
        highlighted: definition.highlighted,
        sortOrder: definition.sortOrder,
      },
      update: {
        name: definition.name,
        description: definition.description,
        priceMonthly: definition.priceMonthly,
        currency: definition.currency,
        stripePriceId,
        limits: definition.limits,
        features: definition.features,
        highlighted: definition.highlighted,
        sortOrder: definition.sortOrder,
      },
    });
  }
}

export function parsePlan(plan: Plan): { limits: PlanLimits; features: PlanFeatures } {
  return {
    limits: planLimitsSchema.parse(plan.limits),
    features: planFeaturesSchema.parse(plan.features),
  };
}

export async function getDefaultPlan(client: PrismaClient = prisma): Promise<Plan> {
  const plan = await client.plan.findUnique({ where: { key: DEFAULT_PLAN_KEY } });
  if (plan) return plan;
  await syncPlans(client);
  return client.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
}

export async function listPlans(): Promise<Array<Plan & { parsed: ReturnType<typeof parsePlan> }>> {
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return plans.map((plan) => ({ ...plan, parsed: parsePlan(plan) }));
}

export async function resolvePlan(ctx: TenantContext): Promise<ResolvedPlan> {
  const subscription = await ctx.db.subscription.findFirst({ include: { plan: true } });
  if (!subscription) throw new NotFoundError("Subscription");
  const { limits, features } = parsePlan(subscription.plan);
  const { plan, ...rest } = subscription;
  return { id: plan.id, key: plan.key, name: plan.name, limits, features, subscription: rest };
}

export async function hasFeature(ctx: TenantContext, feature: PlanFeatureKey): Promise<boolean> {
  const plan = await resolvePlan(ctx);
  const value = plan.features[feature];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

export async function assertFeature(ctx: TenantContext, feature: PlanFeatureKey): Promise<ResolvedPlan> {
  const plan = await resolvePlan(ctx);
  const value = plan.features[feature];
  const enabled = Array.isArray(value) ? value.length > 0 : Boolean(value);
  if (!enabled) throw new FeatureNotInPlanError(feature, plan.name);
  return plan;
}

type ResourceKey = "activeCampaigns" | "members" | "workflows" | "savedSearches";

/** Enforces concurrent resource caps (active campaigns, seats, workflows…). */
export async function assertResourceLimit(ctx: TenantContext, resource: ResourceKey, currentCount: number, adding = 1) {
  const plan = await resolvePlan(ctx);
  const limit = plan.limits.resources[resource];
  if (limit !== null && currentCount + adding > limit) {
    throw new LimitExceededError(`Your ${plan.name} plan allows ${limit} ${resourceLabel(resource)}.`, {
      metric: resource,
      limit,
      used: currentCount,
      requested: adding,
    });
  }
}

function resourceLabel(resource: ResourceKey): string {
  switch (resource) {
    case "activeCampaigns":
      return "active campaigns";
    case "members":
      return "team members";
    case "workflows":
      return "workflows";
    case "savedSearches":
      return "saved searches";
  }
}
