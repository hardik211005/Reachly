import { callFiltersSchema, listCalls, prepareCall, prepareCallSchema } from "@repo/core/calls/service";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: callFiltersSchema, permission: "conversations:read" }, async ({ ctx, query }) => {
  const result = await listCalls(ctx, query);
  return ok(result.items, { total: result.total, page: result.page, pageSize: result.pageSize, counts: result.counts });
});

export const POST = route({ body: prepareCallSchema, permission: "calls:place", rateLimit: 30 }, async ({ ctx, body }) => created(await prepareCall(ctx, body)));
