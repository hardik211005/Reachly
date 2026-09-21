import { executionFiltersSchema, listExecutions } from "@repo/core/workflows/service";
import { ok, route } from "@/lib/api";

export const GET = route({ query: executionFiltersSchema, permission: "workflows:read" }, async ({ ctx, query }) => ok(await listExecutions(ctx, query)));
