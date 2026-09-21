import { runSchema, runWorkflow } from "@repo/core/workflows/service";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof runSchema>({ body: runSchema, permission: "workflows:write", rateLimit: 20 }, async ({ ctx, params, body }) => ok(await runWorkflow(ctx, params.id, body)));
