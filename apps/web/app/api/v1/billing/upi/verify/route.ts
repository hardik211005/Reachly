import { z } from "zod";
import { getBillingOverview } from "@repo/core/billing/overview";
import { verifyUpiPayment } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

/** Razorpay Checkout's success handler posts here; the signature and payment are verified server-side. */
export const POST = route(
  {
    body: z.object({ orderId: z.string().min(3).max(64), paymentId: z.string().min(3).max(64), signature: z.string().min(16).max(256) }),
    permission: "billing:manage",
    rateLimit: 20,
  },
  async ({ ctx, body }) => {
    const result = await verifyUpiPayment(ctx, body);
    return ok({ ...result, overview: await getBillingOverview(ctx) });
  },
);
