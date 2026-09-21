import { z } from "zod";
import { addLeadsToCampaign } from "@repo/core/campaigns/audience";
import { ok, route } from "@/lib/api";

const body = z.object({ leadIds: z.array(z.uuid()).min(1).max(500) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "campaigns:write" }, async ({ ctx, params, body: input }) =>
  ok(await addLeadsToCampaign(ctx, params.id, input.leadIds)),
);
