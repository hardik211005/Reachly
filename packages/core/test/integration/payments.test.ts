import { createHmac } from "node:crypto";
import { addMonths } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@repo/config/env";
import { prisma } from "@repo/db";
import { createStripeClient } from "@repo/integrations";
import { changePlan, getBillingOverview } from "../../src/billing/overview";
import { ingestRazorpayWebhook, ingestStripeWebhook, verifyUpiPayment } from "../../src/billing/payments";
import { hasLapsed, resolvePlan } from "../../src/billing/plans";
import { NotFoundError, PreconditionError, UnauthorizedError, ValidationError } from "../../src/errors";
import { createWorkspace, resetDatabase } from "./helpers";

const KEY_ID = "rzp_test_reachai";
const KEY_SECRET = "rzp_secret_for_tests";
const RAZORPAY_WEBHOOK_SECRET = "razorpay_webhook_secret";
const STRIPE_WEBHOOK_SECRET = "whsec_stripe_test_secret";
const PAYMENT_ENV = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;

function setEnv(values: Partial<Record<(typeof PAYMENT_ENV)[number], string>>) {
  for (const key of PAYMENT_ENV) process.env[key] = values[key] ?? "";
  resetEnvCache();
}

const signCheckout = (orderId: string, paymentId: string) => createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

type Entity = Record<string, unknown>;

/** Stands in for Razorpay's REST API: orders, payments and capture, by id. */
function mockRazorpay(orders: Record<string, Entity>, payments: Record<string, Entity>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const match = /\/v1\/(orders|payments)\/([^/]+)(\/capture)?$/.exec(url);
      const body = match ? (match[1] === "orders" ? orders : payments)[decodeURIComponent(match[2]!)] : undefined;
      if (!body) return new Response(JSON.stringify({ error: { description: "not found" } }), { status: 404 });
      if (match?.[3]) body.status = "captured";
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

function order(id: string, organizationId: string, planKey = "pro", amount = 649_900): Entity {
  return { id, amount, currency: "INR", receipt: `RA-${id}`, status: "paid", notes: { organizationId, planKey } };
}

function payment(id: string, orderId: string, overrides: Entity = {}): Entity {
  return { id, order_id: orderId, amount: 649_900, currency: "INR", status: "captured", method: "upi", email: null, notes: [], created_at: 1_758_000_000, ...overrides };
}

describe("payments", () => {
  beforeEach(async () => {
    await resetDatabase();
    setEnv({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setEnv({});
  });

  it("applies a verified UPI payment exactly once", async () => {
    const { ctx, organizationId } = await createWorkspace();
    mockRazorpay({ order_1: order("order_1", organizationId) }, { pay_1: payment("pay_1", "order_1") });

    const first = await verifyUpiPayment(ctx, { orderId: "order_1", paymentId: "pay_1", signature: signCheckout("order_1", "pay_1") });
    expect(first.status).toBe("applied");
    const plan = await resolvePlan(ctx);
    expect(plan.key).toBe("pro");
    expect(plan.subscription.billingProvider).toBe("razorpay");
    expect(plan.subscription.cancelAtPeriodEnd).toBe(true);
    const periodEnd = plan.subscription.currentPeriodEnd;

    const again = await verifyUpiPayment(ctx, { orderId: "order_1", paymentId: "pay_1", signature: signCheckout("order_1", "pay_1") });
    expect(again.status).toBe("already_applied");
    expect((await resolvePlan(ctx)).subscription.currentPeriodEnd).toEqual(periodEnd);

    const invoices = await prisma.invoice.findMany({ where: { organizationId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "PAID", amountPaid: 649_900, currency: "INR", providerInvoiceId: "order_1" });
    expect(await prisma.payment.count({ where: { organizationId, status: "SUCCEEDED" } })).toBe(1);
  });

  it("rejects bad signatures, other workspaces' orders and short payments", async () => {
    const { ctx, organizationId } = await createWorkspace();
    const other = await createWorkspace("Other Co");
    mockRazorpay(
      { order_1: order("order_1", organizationId), order_2: order("order_2", other.organizationId) },
      { pay_1: payment("pay_1", "order_1", { amount: 100 }), pay_2: payment("pay_2", "order_2") },
    );

    await expect(verifyUpiPayment(ctx, { orderId: "order_1", paymentId: "pay_1", signature: "0".repeat(64) })).rejects.toBeInstanceOf(ValidationError);
    await expect(verifyUpiPayment(ctx, { orderId: "order_2", paymentId: "pay_2", signature: signCheckout("order_2", "pay_2") })).rejects.toBeInstanceOf(NotFoundError);
    await expect(verifyUpiPayment(ctx, { orderId: "order_1", paymentId: "pay_1", signature: signCheckout("order_1", "pay_1") })).rejects.toThrow(/doesn't match/);
    expect((await resolvePlan(ctx)).key).toBe("free");
    expect((await resolvePlan(other.ctx)).key).toBe("free");
  });

  it("captures authorized payments and adds a month when paying again", async () => {
    const { ctx, organizationId } = await createWorkspace();
    const calls = mockRazorpay(
      { order_1: order("order_1", organizationId), order_2: order("order_2", organizationId) },
      { pay_1: payment("pay_1", "order_1", { status: "authorized" }), pay_2: payment("pay_2", "order_2") },
    );

    await verifyUpiPayment(ctx, { orderId: "order_1", paymentId: "pay_1", signature: signCheckout("order_1", "pay_1") });
    expect(calls.some((call) => call.startsWith("POST") && call.endsWith("/payments/pay_1/capture"))).toBe(true);
    const first = (await resolvePlan(ctx)).subscription;

    await verifyUpiPayment(ctx, { orderId: "order_2", paymentId: "pay_2", signature: signCheckout("order_2", "pay_2") });
    const second = (await resolvePlan(ctx)).subscription;
    expect(second.currentPeriodStart).toEqual(first.currentPeriodStart);
    expect(second.currentPeriodEnd).toEqual(addMonths(first.currentPeriodEnd, 1));
  });

  it("verifies Razorpay webhooks, records failures and ignores replays", async () => {
    const { organizationId } = await createWorkspace();
    mockRazorpay({ order_1: order("order_1", organizationId) }, {});
    const body = JSON.stringify({ event: "payment.failed", created_at: 1_758_000_000, payload: { payment: { entity: payment("pay_x", "order_1", { status: "failed", error_description: "UPI app declined" }) } } });
    const signature = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");

    await expect(ingestRazorpayWebhook({ rawBody: body, signature: "bad", eventId: "evt_1" })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await ingestRazorpayWebhook({ rawBody: body, signature, eventId: "evt_1" })).toEqual({ status: "processed" });
    expect(await ingestRazorpayWebhook({ rawBody: body, signature, eventId: "evt_1" })).toEqual({ status: "duplicate" });
    const failed = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: "pay_x" } });
    expect(failed).toMatchObject({ organizationId, status: "FAILED", failureReason: "UPI app declined" });
  });

  it("drops a lapsed prepaid month back to the free plan", async () => {
    const { ctx, organizationId } = await createWorkspace();
    const pro = await prisma.plan.findUniqueOrThrow({ where: { key: "pro" } });
    const ended = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({ where: { organizationId }, data: { planId: pro.id, billingProvider: "razorpay", currentPeriodStart: addMonths(ended, -1), currentPeriodEnd: ended, cancelAtPeriodEnd: true } });

    expect(hasLapsed({ billingProvider: "razorpay", currentPeriodEnd: ended, cancelAtPeriodEnd: true })).toBe(true);
    expect(hasLapsed({ billingProvider: "razorpay", currentPeriodEnd: new Date(), cancelAtPeriodEnd: true })).toBe(false);
    expect(hasLapsed({ billingProvider: "stripe", currentPeriodEnd: ended, cancelAtPeriodEnd: false })).toBe(false);

    const plan = await resolvePlan(ctx);
    expect(plan.key).toBe("free");
    expect(plan.subscription.billingProvider).toBe("none");
  });

  it("records Stripe invoices from signed webhooks", async () => {
    setEnv({ STRIPE_SECRET_KEY: "sk_test_not_used_for_network", STRIPE_WEBHOOK_SECRET });
    const { organizationId } = await createWorkspace();
    await prisma.subscription.update({ where: { organizationId }, data: { providerCustomerId: "cus_test_1" } });
    const payload = JSON.stringify({
      id: "evt_invoice_paid",
      object: "event",
      type: "invoice.paid",
      created: 1_758_000_000,
      data: {
        object: { id: "in_test_1", object: "invoice", customer: "cus_test_1", number: "RA-0001", status: "paid", amount_due: 7900, amount_paid: 7900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/i/test", invoice_pdf: null, period_start: 1_758_000_000, period_end: 1_760_600_000, attempt_count: 1, parent: null },
      },
    });
    const signature = createStripeClient("sk_test_not_used_for_network").webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });

    await expect(ingestStripeWebhook({ rawBody: payload, signature: "t=1,v1=bad" })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await ingestStripeWebhook({ rawBody: payload, signature })).toEqual({ status: "processed" });
    expect(await ingestStripeWebhook({ rawBody: payload, signature })).toEqual({ status: "duplicate" });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { providerInvoiceId: "in_test_1" } });
    expect(invoice).toMatchObject({ organizationId, status: "PAID", amountPaid: 7900, currency: "USD", number: "RA-0001" });
    expect(await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: "in_test_1" } })).toMatchObject({ status: "SUCCEEDED", amount: 7900 });
  });

  it("only switches plans without payment when no provider is configured", async () => {
    const { ctx } = await createWorkspace();
    const overview = await getBillingOverview(ctx);
    expect(overview.payments).toEqual({ stripe: false, razorpay: true });
    expect(overview.directPlanChanges).toBe(false);
    expect(overview.plans.find((plan) => plan.key === "pro")?.priceMonthlyInr).toBe(649_900);
    await expect(changePlan(ctx, "pro")).rejects.toBeInstanceOf(PreconditionError);

    setEnv({});
    expect((await changePlan(ctx, "pro")).plan.key).toBe("pro");
  });
});
