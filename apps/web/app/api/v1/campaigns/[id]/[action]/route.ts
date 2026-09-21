import { archiveCampaign, completeCampaign, duplicateCampaign, pauseCampaign, resumeCampaign } from "@repo/core/campaigns/lifecycle";
import { NotFoundError } from "@repo/core/errors";
import { ok, route } from "@/lib/api";

type Params = { id: string; action: string };

export const POST = route<Params>({ permission: "campaigns:write", rateLimit: 20 }, async ({ ctx, params }) => {
  switch (params.action) {
    case "pause":
      await pauseCampaign(ctx, params.id);
      return ok({ status: "PAUSED" });
    case "resume":
      await resumeCampaign(ctx, params.id);
      return ok({ status: "ACTIVE" });
    case "complete":
      await completeCampaign(ctx, params.id);
      return ok({ status: "COMPLETED" });
    case "archive":
      await archiveCampaign(ctx, params.id);
      return ok({ status: "ARCHIVED" });
    case "duplicate":
      return ok(await duplicateCampaign(ctx, params.id));
    default:
      throw new NotFoundError("Campaign action", params.action);
  }
});
