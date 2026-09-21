import { replySchema, replyToConversation } from "@repo/core/outreach/inbox";
import { created, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof replySchema>({ body: replySchema, permission: "outreach:send", rateLimit: 30 }, async ({ ctx, params, body }) =>
  created(await replyToConversation(ctx, params.id, body)),
);
