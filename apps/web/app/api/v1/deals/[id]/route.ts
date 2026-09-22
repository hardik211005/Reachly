import { dealUpdateSchema, deleteDeal, getDeal, updateDeal } from "@repo/core/crm/deals";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "crm:read" }, async ({ ctx, params }) => ok(await getDeal(ctx, params.id)));

export const PATCH = route<Params, typeof dealUpdateSchema>({ body: dealUpdateSchema, permission: "crm:write" }, async ({ ctx, params, body }) => ok(await updateDeal(ctx, params.id, body)));

export const DELETE = route<Params>({ permission: "crm:write" }, async ({ ctx, params }) => {
  await deleteDeal(ctx, params.id);
  return noContent();
});
