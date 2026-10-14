import { rescoreAllLeads } from "@repo/core/leads/scoring-settings";
import { ok, route } from "@/lib/api";

export const POST = route({ permission: "leads:write", rateLimit: 3 }, async ({ ctx }) => ok(await rescoreAllLeads(ctx)));
