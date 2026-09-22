import { deleteQuote, getQuote, quoteUpdateSchema, updateQuote } from "@repo/core/quotes/service";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "crm:read" }, async ({ ctx, params }) => ok(await getQuote(ctx, params.id)));

export const PATCH = route<Params, typeof quoteUpdateSchema>({ body: quoteUpdateSchema, permission: "quotes:write", rateLimit: 120 }, async ({ ctx, params, body }) =>
  ok(await updateQuote(ctx, params.id, body)),
);

export const DELETE = route<Params>({ permission: "quotes:write" }, async ({ ctx, params }) => {
  await deleteQuote(ctx, params.id);
  return noContent();
});
