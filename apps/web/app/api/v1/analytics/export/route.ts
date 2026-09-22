import { analyticsFilterSchema } from "@repo/core/analytics/filters";
import { EXPORT_DATASETS, exportAnalyticsCsv } from "@repo/core/analytics/report";
import { assertFeature } from "@repo/core/billing/plans";
import { z } from "zod";
import { ApiResponse, route } from "@/lib/api";

const query = analyticsFilterSchema.extend({ dataset: z.enum(EXPORT_DATASETS) });

export const GET = route({ query, permission: "analytics:read", rateLimit: 20 }, async ({ ctx, query: input }) => {
  await assertFeature(ctx, "advancedAnalytics");
  const { dataset, ...filters } = input;
  const { filename, csv } = await exportAnalyticsCsv(ctx, filters, dataset);
  return new ApiResponse(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` });
});
