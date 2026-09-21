import { getCampaign, updateCampaignDraft } from "@repo/core/campaigns/service";
import { deleteCampaign } from "@repo/core/campaigns/lifecycle";
import { campaignInputSchema } from "@repo/core/campaigns/schemas";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "campaigns:read" }, async ({ ctx, params }) => ok(await getCampaign(ctx, params.id)));

export const PUT = route<Params, typeof campaignInputSchema>({ body: campaignInputSchema, permission: "campaigns:write" }, async ({ ctx, params, body }) =>
  ok(await updateCampaignDraft(ctx, params.id, body)),
);

export const DELETE = route<Params>({ permission: "campaigns:write" }, async ({ ctx, params }) => {
  await deleteCampaign(ctx, params.id);
  return noContent();
});
