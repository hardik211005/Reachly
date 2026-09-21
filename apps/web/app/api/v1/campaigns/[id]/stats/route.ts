import { getCampaignStats } from "@repo/core/campaigns/stats";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "campaigns:read" }, async ({ ctx, params }) => ok(await getCampaignStats(ctx, params.id)));
