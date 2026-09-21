import { exportLeadsCsv } from "@repo/core/leads/service";
import { leadListQuerySchema } from "@repo/core/leads/schemas";
import { ApiResponse, route } from "@/lib/api";

export const GET = route({ query: leadListQuerySchema, permission: "leads:export", rateLimit: 10 }, async ({ ctx, query }) => {
  const { filename, csv } = await exportLeadsCsv(ctx, query);
  return new ApiResponse(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` });
});
