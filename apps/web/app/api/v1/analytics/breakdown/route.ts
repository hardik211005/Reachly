import { analyticsFilterSchema } from "@repo/core/analytics/filters";
import { BREAKDOWN_DIMENSIONS, getBreakdown } from "@repo/core/analytics/report";
import { assertFeature } from "@repo/core/billing/plans";
import { z } from "zod";
import { ok, route } from "@/lib/api";

const query = analyticsFilterSchema.extend({ dimension: z.enum(BREAKDOWN_DIMENSIONS) });

export const GET = route({ query, permission: "analytics:read" }, async ({ ctx, query: input }) => {
  await assertFeature(ctx, "advancedAnalytics");
  const { dimension, ...filters } = input;
  return ok(await getBreakdown(ctx, filters, dimension));
});
