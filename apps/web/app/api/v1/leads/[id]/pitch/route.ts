import { z } from "zod";
import { generatePitchPack } from "@repo/core/outreach/pitch";
import { ok, route } from "@/lib/api";

const body = z.object({ campaignId: z.uuid().nullish(), tone: z.string().trim().max(60).optional() });

export const POST = route<{ id: string }, typeof body>({ body, permission: "ai:use", rateLimit: 20 }, async ({ ctx, params, body: input }) =>
  ok(await generatePitchPack(ctx, params.id, input)),
);
