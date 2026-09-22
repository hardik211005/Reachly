import { z } from "zod";
import { markQuote } from "@repo/core/quotes/service";
import { ok, route } from "@/lib/api";

const body = z.object({ decision: z.enum(["accept", "decline"]), note: z.string().trim().max(1000).optional() });

export const POST = route<{ id: string }, typeof body>({ body, permission: "quotes:write" }, async ({ ctx, params, body: input }) => ok(await markQuote(ctx, params.id, input)));
