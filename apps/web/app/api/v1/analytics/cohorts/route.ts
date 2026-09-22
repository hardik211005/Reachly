import { analyticsFilterSchema } from "@repo/core/analytics/filters";
import { COHORT_MILESTONES, getCohorts } from "@repo/core/analytics/report";
import { assertFeature } from "@repo/core/billing/plans";
import { z } from "zod";
import { ok, route } from "@/lib/api";

const query = analyticsFilterSchema.extend({ milestone: z.enum(COHORT_MILESTONES).default("replied") });

export const GET = route({ query, permission: "analytics:read" }, async ({ ctx, query: input }) => {
  await assertFeature(ctx, "advancedAnalytics");
  const { milestone, ...filters } = input;
  return ok(await getCohorts(ctx, filters, milestone));
});
