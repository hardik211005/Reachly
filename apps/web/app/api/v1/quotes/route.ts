import { createQuote, listQuotes, quoteInputSchema, quoteListSchema } from "@repo/core/quotes/service";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: quoteListSchema, permission: "crm:read" }, async ({ ctx, query }) => ok(await listQuotes(ctx, query)));

export const POST = route({ body: quoteInputSchema, permission: "quotes:write" }, async ({ ctx, body }) => created(await createQuote(ctx, body)));
