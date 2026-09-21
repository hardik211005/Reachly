import { z } from "zod";
import { scoreLeadById } from "@repo/core/leads/scoring-service";
import { ok, route } from "@/lib/api";

const body = z.object({ campaignId: z.uuid().nullable().optional() });

export const POST = route<{ id: string }, typeof body>({ body, permission: "leads:write", rateLimit: 30 }, async ({ ctx, params, body: input }) =>
  ok(await scoreLeadById(ctx, params.id, { campaignId: input.campaignId ?? null })),
);
