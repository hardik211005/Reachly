import { getBillingOverview } from "@repo/core/billing/overview";
import { cancelSubscription, resumeSubscription } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

/** Move to the free plan at the end of the paid period (or straight away when nothing was paid). */
export const POST = route({ permission: "billing:manage", rateLimit: 10 }, async ({ ctx }) => {
  await cancelSubscription(ctx);
  return ok(await getBillingOverview(ctx));
});

/** Undo a scheduled cancellation. */
export const DELETE = route({ permission: "billing:manage", rateLimit: 10 }, async ({ ctx }) => {
  await resumeSubscription(ctx);
  return ok(await getBillingOverview(ctx));
});
