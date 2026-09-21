import { deleteLeads, getLead, updateLead } from "@repo/core/leads/service";
import { leadUpdateSchema } from "@repo/core/leads/schemas";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "leads:read" }, async ({ ctx, params }) => ok(await getLead(ctx, params.id)));

export const PATCH = route<Params, typeof leadUpdateSchema>({ body: leadUpdateSchema, permission: "leads:write" }, async ({ ctx, params, body }) =>
  ok(await updateLead(ctx, params.id, body)),
);

export const DELETE = route<Params>({ permission: "leads:delete" }, async ({ ctx, params }) => {
  await deleteLeads(ctx, [params.id]);
  return noContent();
});
