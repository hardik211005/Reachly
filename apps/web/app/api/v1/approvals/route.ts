import { approvalFiltersSchema, listApprovals } from "@repo/core/outreach/approvals";
import { ok, route } from "@/lib/api";

export const GET = route({ query: approvalFiltersSchema, permission: "campaigns:read" }, async ({ ctx, query }) => {
  const result = await listApprovals(ctx, query);
  return ok(result.items, { total: result.total, byCampaign: result.byCampaign });
});
