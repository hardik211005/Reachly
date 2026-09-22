import { z } from "zod";
import { getDeal } from "@repo/core/crm/deals";
import { addNote } from "@repo/core/leads/service";
import { created, route } from "@/lib/api";

const body = z.object({ body: z.string().trim().min(1).max(10_000) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "crm:write" }, async ({ ctx, params, body: input }) => {
  const deal = await getDeal(ctx, params.id);
  return created(await addNote(ctx, { leadId: deal.leadId, dealId: deal.id, body: input.body }));
});
