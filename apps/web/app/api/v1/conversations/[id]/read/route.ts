import { markConversationRead } from "@repo/core/outreach/inbox";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "conversations:read" }, async ({ ctx, params }) => ok(await markConversationRead(ctx, params.id)));
