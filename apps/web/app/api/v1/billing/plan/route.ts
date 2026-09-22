import { z } from "zod";
import { changePlan } from "@repo/core/billing/overview";
import { ok, route } from "@/lib/api";

/** Plan change without payment (only when no payment provider is configured). */
export const POST = route({ body: z.object({ plan: z.string().min(1).max(40) }), permission: "billing:manage", rateLimit: 10 }, async ({ ctx, body }) => ok(await changePlan(ctx, body.plan)));
