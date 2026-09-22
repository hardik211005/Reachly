import { listLeadDeals } from "@repo/core/crm/deals";
import { listQuotes } from "@repo/core/quotes/service";
import { ok, route } from "@/lib/api";

/** Deals and quotes for the lead workspace. */
export const GET = route<{ id: string }>({ permission: "crm:read" }, async ({ ctx, params }) => {
  const [deals, quotes] = await Promise.all([listLeadDeals(ctx, params.id), listQuotes(ctx, { leadId: params.id })]);
  return ok({ deals, quotes: quotes.quotes });
});
