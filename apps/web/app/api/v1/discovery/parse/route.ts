import { z } from "zod";
import { parseDiscoveryQuery } from "@repo/core/discovery/service";
import { ok, route } from "@/lib/api";

const body = z.object({ query: z.string().trim().min(3).max(500), campaignId: z.uuid().optional() });

export const POST = route({ body, permission: "discovery:run", rateLimit: 30 }, async ({ ctx, body: input }) => ok(await parseDiscoveryQuery(ctx, input.query, input.campaignId)));
