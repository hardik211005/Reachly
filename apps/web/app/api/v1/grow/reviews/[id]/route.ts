import { z } from "zod";
import { setReviewVisibility } from "@repo/core/grow/service";
import { ok, route } from "@/lib/api";

const body = z.object({ visible: z.boolean() });

export const PATCH = route<{ id: string }, typeof body>(
  { body, permission: "crm:write", rateLimit: 30 },
  async ({ ctx, params, body: input }) =>
    ok(await setReviewVisibility(ctx, params.id, input.visible)),
);
