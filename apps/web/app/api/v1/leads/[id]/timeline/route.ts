import { z } from "zod";
import { getLeadTimeline } from "@repo/core/leads/service";
import { ok, route } from "@/lib/api";

const query = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export const GET = route<{ id: string }, undefined, typeof query>({ query, permission: "leads:read" }, async ({ ctx, params, query: q }) =>
  ok(await getLeadTimeline(ctx, params.id, q)),
);
