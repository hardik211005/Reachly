import { inboxFiltersSchema, listConversations } from "@repo/core/outreach/inbox";
import { ok, route } from "@/lib/api";

export const GET = route({ query: inboxFiltersSchema, permission: "conversations:read" }, async ({ ctx, query }) => {
  const result = await listConversations(ctx, query);
  return ok(result.items, { nextCursor: result.nextCursor, counts: result.counts });
});
