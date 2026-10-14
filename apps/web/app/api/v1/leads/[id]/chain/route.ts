import { z } from "zod";
import { markLeadChain } from "@repo/core/leads/scoring-settings";
import { ok, route } from "@/lib/api";

const body = z.object({ isChain: z.boolean() });

/** Mark every outlet with this lead's name as a chain (or as independent), now and in future searches. */
export const POST = route<{ id: string }, typeof body>({ body, permission: "leads:write", rateLimit: 30 }, async ({ ctx, params, body: input }) => ok(await markLeadChain(ctx, params.id, input.isChain)));
