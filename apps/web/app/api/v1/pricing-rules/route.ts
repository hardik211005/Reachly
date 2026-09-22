import { createPricingRule, pricingRuleInputSchema } from "@repo/core/quotes/catalog";
import { created, route } from "@/lib/api";

export const POST = route({ body: pricingRuleInputSchema, permission: "workspace:manage" }, async ({ ctx, body }) => created(await createPricingRule(ctx, body)));
