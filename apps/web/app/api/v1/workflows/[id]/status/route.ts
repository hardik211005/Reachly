import { z } from "zod";
import { setWorkflowStatus } from "@repo/core/workflows/service";
import { ok, route } from "@/lib/api";

const body = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "workflows:write" }, async ({ ctx, params, body: input }) => ok(await setWorkflowStatus(ctx, params.id, input.status)));
