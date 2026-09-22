import { sendQuote, sendQuoteSchema } from "@repo/core/quotes/service";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof sendQuoteSchema>({ body: sendQuoteSchema, permission: "quotes:write", rateLimit: 20 }, async ({ ctx, params, body }) =>
  ok(await sendQuote(ctx, params.id, body)),
);
