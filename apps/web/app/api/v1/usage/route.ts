import { resolvePlan } from "@repo/core/billing/plans";
import { getUsage } from "@repo/core/billing/usage";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => {
  const [plan, usage] = await Promise.all([resolvePlan(ctx), getUsage(ctx)]);
  return ok({ plan: { key: plan.key, name: plan.name, features: plan.features, limits: plan.limits }, ...usage });
});
