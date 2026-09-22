import { insightListSchema, listInsights } from "@repo/core/insights/service";
import { ok, route } from "@/lib/api";

export const GET = route({ query: insightListSchema, permission: "analytics:read" }, async ({ ctx, query }) => ok(await listInsights(ctx, query)));
