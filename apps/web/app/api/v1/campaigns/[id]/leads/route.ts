import { z } from "zod";
import { addLeadsByFilter, addLeadsToCampaign, campaignLeadsQuerySchema, listCampaignLeads, removeLeadFromCampaign } from "@repo/core/campaigns/audience";
import { leadListQuerySchema } from "@repo/core/leads/schemas";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params, undefined, typeof campaignLeadsQuerySchema>({ query: campaignLeadsQuerySchema, permission: "campaigns:read" }, async ({ ctx, params, query }) => {
  const result = await listCampaignLeads(ctx, params.id, query);
  return ok(result.items, { total: result.total, page: result.page, pageSize: result.pageSize, steps: result.steps });
});

const body = z.union([
  z.object({ leadIds: z.array(z.uuid()).min(1).max(500) }),
  z.object({ filters: leadListQuerySchema.partial() }),
]);

export const POST = route<Params, typeof body>({ body, permission: "campaigns:write" }, async ({ ctx, params, body: input }) =>
  ok("leadIds" in input ? await addLeadsToCampaign(ctx, params.id, input.leadIds) : await addLeadsByFilter(ctx, params.id, input.filters)),
);

const removeQuery = z.object({ leadId: z.uuid() });

export const DELETE = route<Params, undefined, typeof removeQuery>({ query: removeQuery, permission: "campaigns:write" }, async ({ ctx, params, query }) => {
  await removeLeadFromCampaign(ctx, params.id, query.leadId);
  return noContent();
});
