import { dealMoveSchema, moveDeal } from "@repo/core/crm/deals";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof dealMoveSchema>({ body: dealMoveSchema, permission: "crm:write", rateLimit: 120 }, async ({ ctx, params, body }) =>
  ok(await moveDeal(ctx, params.id, body)),
);
