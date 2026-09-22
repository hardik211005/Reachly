import Stripe from "stripe";

/**
 * Stripe adapter. The SDK does the HTTP work; these helpers read the fields that moved in
 * recent API versions (billing periods live on subscription items, the subscription of an
 * invoice lives under `parent.subscription_details`).
 */
export { Stripe };

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Reachly" } });
}

export type LocalSubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";

export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): LocalSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
    case "paused":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

/** The billing period covered by a subscription: the span of its items' periods. */
export function stripeSubscriptionPeriod(subscription: Stripe.Subscription): { start: Date; end: Date } {
  const items = subscription.items.data;
  const start = items.length ? Math.min(...items.map((item) => item.current_period_start)) : subscription.start_date;
  const end = items.length ? Math.max(...items.map((item) => item.current_period_end)) : subscription.start_date;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return stripeId(invoice.parent?.subscription_details?.subscription);
}

/** Lookup key for the monthly price Reachly creates for a plan, so it's reused across checkouts. */
export function stripeLookupKey(planKey: string, amount: number, currency: string): string {
  return `reachly_${planKey}_monthly_${currency.toLowerCase()}_${amount}`;
}
