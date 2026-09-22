import { z } from "zod";
import { setInsightDismissed } from "@repo/core/insights/service";
import { ok, route } from "@/lib/api";

const body = z.object({ dismissed: z.boolean().default(true) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "analytics:read" }, async ({ ctx, params, body: input }) => ok(await setInsightDismissed(ctx, params.id, input.dismissed)));
