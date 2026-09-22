import { deletePricingRule, pricingRuleInputSchema, updatePricingRule } from "@repo/core/quotes/catalog";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const PATCH = route<Params, typeof pricingRuleInputSchema>({ body: pricingRuleInputSchema, permission: "workspace:manage" }, async ({ ctx, params, body }) =>
  ok(await updatePricingRule(ctx, params.id, body)),
);

export const DELETE = route<Params>({ permission: "workspace:manage" }, async ({ ctx, params }) => {
  await deletePricingRule(ctx, params.id);
  return noContent();
});
