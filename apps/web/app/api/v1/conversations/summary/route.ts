import { dueTaskCount } from "@repo/core/crm/tasks";
import { inboxSummary } from "@repo/core/outreach/inbox";
import { ok, route } from "@/lib/api";

/** Attention counts for the sidebar. */
export const GET = route({ permission: "conversations:read" }, async ({ ctx }) => {
  const [summary, tasksDue] = await Promise.all([inboxSummary(ctx), dueTaskCount(ctx)]);
  return ok({ ...summary, tasksDue });
});
