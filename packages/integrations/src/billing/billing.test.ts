import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { razorpayNote, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from "./razorpay";
import { mapStripeSubscriptionStatus, stripeId, stripeLookupKey, stripeSubscriptionPeriod, type Stripe } from "./stripe";

describe("stripe helpers", () => {
  it("maps subscription statuses onto ours", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("ACTIVE");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("TRIALING");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("PAST_DUE");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("PAST_DUE");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("CANCELED");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("CANCELED");
    expect(mapStripeSubscriptionStatus("incomplete")).toBe("INCOMPLETE");
  });

  it("reads the billing period from subscription items", () => {
    const subscription = { start_date: 100, items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] } } as unknown as Stripe.Subscription;
    expect(stripeSubscriptionPeriod(subscription)).toEqual({ start: new Date(1_700_000_000_000), end: new Date(1_702_592_000_000) });
  });

  it("normalises ids and builds stable lookup keys", () => {
    expect(stripeId("cus_1")).toBe("cus_1");
    expect(stripeId({ id: "cus_2" })).toBe("cus_2");
    expect(stripeId(null)).toBeNull();
    expect(stripeLookupKey("pro", 7900, "USD")).toBe("reachly_pro_monthly_usd_7900");
  });
});

describe("razorpay signatures", () => {
  it("verifies the checkout handler signature", () => {
    const signature = createHmac("sha256", "secret").update("order_1|pay_1").digest("hex");
    expect(verifyRazorpayPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature, keySecret: "secret" })).toBe(true);
    expect(verifyRazorpayPaymentSignature({ orderId: "order_1", paymentId: "pay_2", signature, keySecret: "secret" })).toBe(false);
    expect(verifyRazorpayPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature, keySecret: "other" })).toBe(false);
  });

  it("verifies webhook bodies", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const signature = createHmac("sha256", "hook").update(body).digest("hex");
    expect(verifyRazorpayWebhookSignature(body, signature, "hook")).toBe(true);
    expect(verifyRazorpayWebhookSignature(`${body} `, signature, "hook")).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, null, "hook")).toBe(false);
  });

  it("reads notes whether Razorpay sends an object or an empty array", () => {
    expect(razorpayNote({ notes: { organizationId: "org_1" } }, "organizationId")).toBe("org_1");
    expect(razorpayNote({ notes: [] }, "organizationId")).toBeNull();
  });
});
