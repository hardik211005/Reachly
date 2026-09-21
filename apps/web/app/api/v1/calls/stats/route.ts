import { z } from "zod";
import { callsOverview } from "@repo/core/calls/stats";
import { ok, route } from "@/lib/api";

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = route({ query, permission: "conversations:read" }, async ({ ctx, query: input }) => ok(await callsOverview(ctx, input.days)));
