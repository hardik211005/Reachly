import { z } from "zod";
import { analyzeBusiness } from "@repo/core/business/service";
import { ok, route } from "@/lib/api";

export const POST = route(
  { body: z.object({ fresh: z.boolean().default(false) }), permission: "ai:use", rateLimit: 10 },
  async ({ ctx, body }) => {
    const { icp, meta } = await analyzeBusiness(ctx, { fresh: body.fresh });
    return ok({ icp, meta: { provider: meta.provider, model: meta.model, cached: meta.cached, credits: meta.credits } });
  },
);
