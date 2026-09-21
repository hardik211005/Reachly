import { getExecution } from "@repo/core/workflows/service";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "workflows:read" }, async ({ ctx, params }) => ok(await getExecution(ctx, params.id)));
