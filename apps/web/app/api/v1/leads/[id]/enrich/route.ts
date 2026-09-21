import { enrichLead } from "@repo/core/leads/enrichment";
import { scoreLeadById } from "@repo/core/leads/scoring-service";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "leads:write", rateLimit: 20 }, async ({ ctx, params }) => {
  const enrichment = await enrichLead(ctx, params.id);
  const score = await scoreLeadById(ctx, params.id);
  return ok({ enrichment, score: { total: score.total, qualification: score.qualification } });
});
