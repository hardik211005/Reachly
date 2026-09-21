import { directMessageSchema, sendDirectMessage } from "@repo/core/outreach/inbox";
import { created, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof directMessageSchema>({ body: directMessageSchema, permission: "outreach:send", rateLimit: 30 }, async ({ ctx, params, body }) =>
  created(await sendDirectMessage(ctx, params.id, body)),
);
