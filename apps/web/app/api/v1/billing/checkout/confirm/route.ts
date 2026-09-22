import { z } from "zod";
import { getBillingOverview } from "@repo/core/billing/overview";
import { confirmStripeCheckout } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

/** After Stripe Checkout redirects back: re-read the session from Stripe and apply it. */
export const POST = route({ body: z.object({ sessionId: z.string().min(3).max(255) }), permission: "billing:manage", rateLimit: 20 }, async ({ ctx, body }) => {
  const result = await confirmStripeCheckout(ctx, body.sessionId);
  return ok({ ...result, overview: await getBillingOverview(ctx) });
});
