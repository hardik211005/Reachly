import { z } from "zod";
import { launchCampaign } from "@repo/core/campaigns/lifecycle";
import { ok, route } from "@/lib/api";

/** Launch requires an explicit `confirm: true` — the UI shows the estimate first. */
const body = z.object({ confirm: z.literal(true, { error: "Confirm the launch to continue" }) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "campaigns:launch", rateLimit: 10 }, async ({ ctx, params, body: input }) =>
  ok(await launchCampaign(ctx, params.id, input)),
);
