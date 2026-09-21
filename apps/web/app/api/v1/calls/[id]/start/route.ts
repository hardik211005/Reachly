import { z } from "zod";
import { startCall } from "@repo/core/calls/service";
import { ok, route } from "@/lib/api";

/** Placing a call always needs an explicit confirmation. */
const body = z.object({ confirm: z.literal(true, { error: "Confirm the call to start it" }) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "calls:place", rateLimit: 20 }, async ({ ctx, params, body: input }) => ok(await startCall(ctx, params.id, input)));
