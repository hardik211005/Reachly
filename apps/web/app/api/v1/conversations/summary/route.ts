import { inboxSummary } from "@repo/core/outreach/inbox";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "conversations:read" }, async ({ ctx }) => ok(await inboxSummary(ctx)));
