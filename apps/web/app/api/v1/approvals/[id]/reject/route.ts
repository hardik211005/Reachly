import { z } from "zod";
import { rejectMessage } from "@repo/core/outreach/approvals";
import { ok, route } from "@/lib/api";

const body = z.object({ reason: z.string().trim().max(300).optional(), action: z.enum(["skip_step", "stop_lead"]).default("skip_step") });

export const POST = route<{ id: string }, typeof body>({ body, permission: "outreach:approve" }, async ({ ctx, params, body: input }) =>
  ok(await rejectMessage(ctx, params.id, input)),
);
