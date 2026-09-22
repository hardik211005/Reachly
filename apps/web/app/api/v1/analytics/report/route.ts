import { analyticsFilterSchema } from "@repo/core/analytics/filters";
import { getAnalyticsReport } from "@repo/core/analytics/report";
import { ok, route } from "@/lib/api";

export const GET = route({ query: analyticsFilterSchema, permission: "analytics:read" }, async ({ ctx, query }) => ok(await getAnalyticsReport(ctx, query)));
