import { previewAudience } from "@repo/core/campaigns/audience";
import { leadListQuerySchema } from "@repo/core/leads/schemas";
import { ok, route } from "@/lib/api";

export const POST = route({ body: leadListQuerySchema.partial(), permission: "leads:read" }, async ({ ctx, body }) => ok(await previewAudience(ctx, body)));
