import { z } from "zod";
import { startCheckout } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

/** Start paying for a plan: a Stripe Checkout URL, a Razorpay order for UPI, or an in-place Stripe plan switch. */
export const POST = route(
  { body: z.object({ plan: z.string().min(1).max(40), provider: z.enum(["stripe", "razorpay"]) }), permission: "billing:manage", rateLimit: 10 },
  async ({ ctx, body }) => ok(await startCheckout(ctx, body)),
);
