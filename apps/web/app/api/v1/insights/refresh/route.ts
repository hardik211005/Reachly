import { assertFeature } from "@repo/core/billing/plans";
import { generateInsights } from "@repo/core/insights/service";
import { ok, route } from "@/lib/api";

/** Recompute insights now (they also refresh daily in the background). */
export const POST = route({ permission: "analytics:read", rateLimit: 6 }, async ({ ctx }) => {
  await assertFeature(ctx, "aiInsights");
  return ok(await generateInsights(ctx));
});
