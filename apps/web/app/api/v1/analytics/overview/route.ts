import { analyticsFilterSchema } from "@repo/core/analytics/filters";
import { getOverview } from "@repo/core/analytics/overview";
import { ok, route } from "@/lib/api";

export const GET = route({ query: analyticsFilterSchema, permission: "analytics:read" }, async ({ ctx, query }) => {
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
  return ok(await getOverview(ctx, query, org.timezone));
});
