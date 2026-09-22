import { openBillingPortal } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

/** Stripe customer portal: cards, invoices and cancellation. */
export const POST = route({ permission: "billing:manage", rateLimit: 10 }, async ({ ctx }) => ok(await openBillingPortal(ctx)));
