import { bulkLeadAction } from "@repo/core/leads/service";
import { bulkLeadActionSchema } from "@repo/core/leads/schemas";
import { ok, route } from "@/lib/api";

export const POST = route({ body: bulkLeadActionSchema, rateLimit: 30 }, async ({ ctx, body }) => ok(await bulkLeadAction(ctx, body)));
