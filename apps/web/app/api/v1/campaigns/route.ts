import { createCampaign } from "@repo/core/campaigns/service";
import { campaignInputSchema } from "@repo/core/campaigns/schemas";
import { listCampaignsWithStats } from "@repo/core/campaigns/stats";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "campaigns:read" }, async ({ ctx }) => ok(await listCampaignsWithStats(ctx)));

export const POST = route({ body: campaignInputSchema, permission: "campaigns:write" }, async ({ ctx, body }) => created(await createCampaign(ctx, body)));
