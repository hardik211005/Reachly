import { addMonths } from "date-fns";
import { DEFAULT_PLAN_KEY, PLAN_DEFINITIONS } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { prisma, type Plan, type Prisma, type Subscription } from "@repo/db";
import {
  IntegrationError,
  RazorpayClient,
  createStripeClient,
  mapStripeSubscriptionStatus,
  razorpayNote,
  stripeId,
  stripeInvoiceSubscriptionId,
  stripeLookupKey,
  stripeSubscriptionPeriod,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  type RazorpayOrder,
  type RazorpayPayment,
  type Stripe,
} from "@repo/integrations";
import { audit } from "../audit";
import { assertCan, systemContext, type TenantContext } from "../context";
import { AppError, NotFoundError, PreconditionError, ProviderError, ProviderNotConfiguredError, UnauthorizedError, ValidationError } from "../errors";
import { logger } from "../logger";
import { getDefaultPlan } from "./plans";
import { changePlanWithoutPayment } from "./subscription";

/**
 * Payments. Two providers, both optional and switched on by their keys:
 *
 * - Stripe: card subscriptions that renew monthly. Checkout creates the subscription,
 *   webhooks keep plan, status, period and invoices in sync, and the customer portal handles
 *   cards and cancellation. Returning from checkout also syncs, so it works without webhooks.
 * - Razorpay: UPI (and Indian cards/netbanking) in INR. Each payment buys one month of a plan;
 *   nothing auto-debits. When the month (plus a short grace) is over the workspace drops back
 *   to the free plan — see `hasLapsed` in plans.ts.
 *
 * Nothing here trusts the browser: Stripe sessions and Razorpay payments are re-read from the
 * provider, and webhook bodies are signature-checked before use.
 */

export type PaymentProvider = "stripe" | "razorpay";

export function paymentProviders(): Record<PaymentProvider, boolean> {
  const env = getEnv();
  return { stripe: Boolean(env.STRIPE_SECRET_KEY), razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) };
}

export function paymentsConfigured(): boolean {
  const providers = paymentProviders();
  return providers.stripe || providers.razorpay;
}

/** UPI price for a plan in paise, when it's sold over UPI. */
export function upiPrice(planKey: string): number | null {
  return PLAN_DEFINITIONS.find((definition) => definition.key === planKey)?.priceMonthlyInr ?? null;
}

function stripe(): Stripe {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new ProviderNotConfiguredError("card payments", "Add STRIPE_SECRET_KEY to enable Stripe.");
  return createStripeClient(key);
}

function razorpay(): { client: RazorpayClient; keyId: string; keySecret: string } {
  const env = getEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new ProviderNotConfiguredError("UPI payments", "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable Razorpay.");
  return { client: new RazorpayClient(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET), keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

/** Provider SDK and HTTP errors become a readable ProviderError instead of a 500. */
async function call<T>(provider: PaymentProvider, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const stripeType = (error as { type?: unknown }).type;
    if (typeof stripeType === "string" && stripeType.startsWith("Stripe")) throw new ProviderError("Stripe", (error as Error).message, stripeType === "StripeConnectionError" || stripeType === "StripeAPIError");
    if (error instanceof IntegrationError) throw new ProviderError("Razorpay", error.message.replace(/^razorpay: /, ""), error.retryable);
    throw error;
  }
}

function billingUrl(query: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/app/billing?${query}`;
}

async function purchasablePlan(planKey: string): Promise<Plan> {
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive) throw new NotFoundError("Plan", planKey);
  if (plan.priceMonthly <= 0) throw new ValidationError("The free plan doesn't need a payment");
  return plan;
}

async function currentSubscription(ctx: TenantContext): Promise<Subscription & { plan: Plan }> {
  const subscription = await ctx.db.subscription.findFirst({ include: { plan: true } });
  if (!subscription) throw new NotFoundError("Subscription");
  return subscription;
}

async function payer(ctx: TenantContext): Promise<{ workspace: string; name: string; email: string | null }> {
  const [organization, user] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } }),
    ctx.userId ? prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }) : null,
  ]);
  return { workspace: organization.name, name: user?.name ?? "", email: user?.email ?? null };
}

// ----------------------------------------------------------------------------- Checkout

export type CheckoutStart =
  | { kind: "redirect"; provider: "stripe"; url: string }
  | { kind: "updated"; provider: "stripe" }
  | { kind: "razorpay"; provider: "razorpay"; keyId: string; orderId: string; amount: number; currency: string; planName: string; workspace: string; prefill: { name: string; email: string | null } };

export async function startCheckout(ctx: TenantContext, input: { plan: string; provider: PaymentProvider }): Promise<CheckoutStart> {
  assertCan(ctx, "billing:manage");
  const plan = await purchasablePlan(input.plan);
  const subscription = await currentSubscription(ctx);
  const result = input.provider === "stripe" ? await startStripeCheckout(ctx, plan, subscription) : await startUpiCheckout(ctx, plan);
  await audit(ctx, { action: "billing.checkout_started", resourceType: "subscription", resourceId: subscription.id, metadata: { provider: input.provider, planKey: plan.key, kind: result.kind } });
  return result;
}

/** The monthly Stripe price for a plan: the configured price id, or one Reachly created earlier (by lookup key), or a new one. */
async function stripePriceFor(client: Stripe, plan: Plan): Promise<string> {
  if (plan.stripePriceId) return plan.stripePriceId;
  const lookupKey = stripeLookupKey(plan.key, plan.priceMonthly, plan.currency);
  const existing = await client.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const price = await client.prices.create({
    currency: plan.currency.toLowerCase(),
    unit_amount: plan.priceMonthly,
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    product_data: { name: `Reachly ${plan.name}`, metadata: { planKey: plan.key } },
    metadata: { planKey: plan.key },
  });
  return price.id;
}

async function ensureStripeCustomer(ctx: TenantContext, client: Stripe, subscription: Subscription): Promise<string> {
  if (subscription.providerCustomerId?.startsWith("cus_")) return subscription.providerCustomerId;
  const who = await payer(ctx);
  const customer = await client.customers.create({ name: who.workspace, email: who.email ?? undefined, metadata: { organizationId: ctx.organizationId } });
  await ctx.db.subscription.update({ where: { id: subscription.id }, data: { providerCustomerId: customer.id } });
  return customer.id;
}

function hasLiveStripeSubscription(subscription: Subscription): subscription is Subscription & { providerSubscriptionId: string } {
  return subscription.billingProvider === "stripe" && Boolean(subscription.providerSubscriptionId) && subscription.status !== "CANCELED" && subscription.status !== "INCOMPLETE";
}

async function startStripeCheckout(ctx: TenantContext, plan: Plan, subscription: Subscription): Promise<CheckoutStart> {
  const client = stripe();
  return call("stripe", async () => {
    const price = await stripePriceFor(client, plan);
    // Already paying by card: move the existing subscription to the new price (prorated) rather than starting a second one.
    if (hasLiveStripeSubscription(subscription)) {
      const current = await client.subscriptions.retrieve(subscription.providerSubscriptionId);
      const item = current.items.data[0];
      if (!item) throw new PreconditionError("The Stripe subscription has no items to change");
      const updated = await client.subscriptions.update(current.id, {
        items: [{ id: item.id, price }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata: { organizationId: ctx.organizationId, planKey: plan.key },
      });
      await applyStripeSubscription(updated, ctx.organizationId);
      return { kind: "updated", provider: "stripe" };
    }
    const customer = await ensureStripeCustomer(ctx, client, subscription);
    const metadata = { organizationId: ctx.organizationId, planKey: plan.key };
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: ctx.organizationId,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
      success_url: billingUrl("checkout=success&session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: billingUrl("checkout=cancelled"),
    });
    if (!session.url) throw new ProviderError("Stripe", "Checkout didn't return a URL");
    return { kind: "redirect", provider: "stripe", url: session.url };
  });
}

async function startUpiCheckout(ctx: TenantContext, plan: Plan): Promise<CheckoutStart> {
  const amount = upiPrice(plan.key);
  if (!amount) throw new ValidationError(`${plan.name} can't be paid over UPI`);
  const { client, keyId } = razorpay();
  const who = await payer(ctx);
  const order = await call("razorpay", () =>
    client.createOrder({ amount, currency: "INR", receipt: `RA-${Date.now().toString(36).toUpperCase()}`, notes: { organizationId: ctx.organizationId, planKey: plan.key } }),
  );
  return { kind: "razorpay", provider: "razorpay", keyId, orderId: order.id, amount: order.amount, currency: order.currency, planName: plan.name, workspace: who.workspace, prefill: { name: who.name, email: who.email } };
}

/** Called when the browser returns from Stripe Checkout, so the plan updates even before (or without) webhooks. */
export async function confirmStripeCheckout(ctx: TenantContext, sessionId: string): Promise<{ status: "complete" | "open" | "expired" }> {
  assertCan(ctx, "billing:manage");
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ValidationError("That isn't a checkout session id");
  const client = stripe();
  return call("stripe", async () => {
    const session = await client.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (session.client_reference_id !== ctx.organizationId) throw new NotFoundError("Checkout session");
    if (session.status !== "complete") return { status: session.status === "expired" ? "expired" : "open" };
    if (session.subscription && typeof session.subscription === "object") await applyStripeSubscription(session.subscription, ctx.organizationId);
    const invoiceId = stripeId(session.invoice);
    if (invoiceId) {
      const invoice = await client.invoices.retrieve(invoiceId);
      await recordStripeInvoice(invoice, invoice.status === "paid" ? "invoice.paid" : "invoice.finalized");
    }
    return { status: "complete" };
  });
}

/** Called from Razorpay Checkout's success handler. */
export async function verifyUpiPayment(ctx: TenantContext, input: { orderId: string; paymentId: string; signature: string }) {
  assertCan(ctx, "billing:manage");
  const { client, keySecret } = razorpay();
  if (!verifyRazorpayPaymentSignature({ ...input, keySecret })) throw new ValidationError("The payment signature didn't match. If money was taken, it will be refunded by Razorpay automatically.");
  const [order, payment] = await call("razorpay", () => Promise.all([client.fetchOrder(input.orderId), client.fetchPayment(input.paymentId)]));
  if (razorpayNote(order, "organizationId") !== ctx.organizationId) throw new NotFoundError("Order");
  const outcome = await applyUpiPayment(client, order, payment);
  if (outcome === "failed") throw new ValidationError(payment.error_description || "The payment failed");
  if (outcome === "pending") throw new PreconditionError("The payment is still processing. Your plan updates as soon as Razorpay confirms it.");
  return { status: outcome };
}

// ----------------------------------------------------------------------------- Manage

export async function openBillingPortal(ctx: TenantContext): Promise<{ url: string }> {
  assertCan(ctx, "billing:manage");
  const subscription = await currentSubscription(ctx);
  if (!subscription.providerCustomerId?.startsWith("cus_")) throw new PreconditionError("There's no card on file yet — subscribe with a card first.");
  const client = stripe();
  const session = await call("stripe", () => client.billingPortal.sessions.create({ customer: subscription.providerCustomerId!, return_url: billingUrl("portal=returned") }));
  return { url: session.url };
}

/** Moves to the free plan: at the end of the paid period when there is one, straight away otherwise. */
export async function cancelSubscription(ctx: TenantContext): Promise<void> {
  assertCan(ctx, "billing:manage");
  const subscription = await currentSubscription(ctx);
  if (hasLiveStripeSubscription(subscription)) {
    const client = stripe();
    const updated = await call("stripe", () => client.subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: true }));
    await applyStripeSubscription(updated, ctx.organizationId);
  } else if (subscription.billingProvider === "razorpay") {
    // Prepaid: nothing renews anyway; the plan simply runs to the end of the month already paid for.
    await ctx.db.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } });
  } else {
    await changePlanWithoutPayment(ctx, DEFAULT_PLAN_KEY);
    return;
  }
  await audit(ctx, { action: "billing.cancel_scheduled", resourceType: "subscription", resourceId: subscription.id, metadata: { provider: subscription.billingProvider, endsAt: subscription.currentPeriodEnd.toISOString() } });
}

export async function resumeSubscription(ctx: TenantContext): Promise<void> {
  assertCan(ctx, "billing:manage");
  const subscription = await currentSubscription(ctx);
  if (!hasLiveStripeSubscription(subscription) || !subscription.cancelAtPeriodEnd) throw new PreconditionError("There's no scheduled cancellation to undo");
  const client = stripe();
  const updated = await call("stripe", () => client.subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: false }));
  await applyStripeSubscription(updated, ctx.organizationId);
  await audit(ctx, { action: "billing.cancel_undone", resourceType: "subscription", resourceId: subscription.id });
}

// ----------------------------------------------------------------------------- Stripe sync

async function planIdForStripe(subscription: Stripe.Subscription): Promise<string | null> {
  // The price actually being paid wins over metadata: portal plan switches change the price only.
  const prices = subscription.items.data.map((item) => item.price);
  const configured = await prisma.plan.findFirst({ where: { stripePriceId: { in: prices.map((price) => price.id) } }, select: { id: true } });
  if (configured) return configured.id;
  for (const price of prices) {
    const key = price.lookup_key ? /^reachly_([a-z0-9_-]+?)_monthly_/.exec(price.lookup_key)?.[1] : undefined;
    const plan = key ? await prisma.plan.findUnique({ where: { key }, select: { id: true } }) : null;
    if (plan) return plan.id;
  }
  const fromMetadata = subscription.metadata?.planKey;
  const plan = fromMetadata ? await prisma.plan.findUnique({ where: { key: fromMetadata }, select: { id: true } }) : null;
  return plan?.id ?? null;
}

async function organizationForCustomer(customerId: string | null, fallback: string | null | undefined): Promise<string | null> {
  if (customerId) {
    const local = await prisma.subscription.findUnique({ where: { providerCustomerId: customerId }, select: { organizationId: true } });
    if (local) return local.organizationId;
  }
  return fallback ?? null;
}

/** Mirrors a Stripe subscription onto the workspace's subscription row. Returns the workspace id it applied to. */
async function applyStripeSubscription(subscription: Stripe.Subscription, fallbackOrganizationId?: string | null): Promise<string | null> {
  const organizationId = await organizationForCustomer(stripeId(subscription.customer), subscription.metadata?.organizationId ?? fallbackOrganizationId);
  if (!organizationId) return null;
  const local = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!local) return null;
  const status = mapStripeSubscriptionStatus(subscription.status);
  const replaced = local.providerSubscriptionId !== null && local.providerSubscriptionId !== subscription.id;
  const ctx = systemContext(organizationId);

  if (status === "CANCELED" || status === "INCOMPLETE") {
    // A subscription the workspace has since replaced, or a checkout that never finished: nothing to change.
    if (replaced || local.billingProvider !== "stripe" || status === "INCOMPLETE") return organizationId;
    const free = await getDefaultPlan();
    const now = new Date();
    await prisma.subscription.update({
      where: { id: local.id },
      data: { planId: free.id, status: "ACTIVE", billingProvider: "none", providerSubscriptionId: null, cancelAtPeriodEnd: false, currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1) },
    });
    await audit(ctx, { action: "billing.subscription_ended", resourceType: "subscription", resourceId: local.id, metadata: { provider: "stripe", stripeSubscriptionId: subscription.id } });
    return organizationId;
  }

  const planId = await planIdForStripe(subscription);
  if (!planId) {
    logger.warn({ organizationId, stripeSubscriptionId: subscription.id }, "stripe subscription has no matching plan");
    return organizationId;
  }
  const period = stripeSubscriptionPeriod(subscription);
  const changedPlan = local.planId !== planId;
  await prisma.subscription.update({
    where: { id: local.id },
    data: {
      planId,
      status,
      billingProvider: "stripe",
      providerCustomerId: stripeId(subscription.customer) ?? local.providerCustomerId,
      providerSubscriptionId: subscription.id,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at !== null,
    },
  });
  if (changedPlan || replaced || local.billingProvider !== "stripe") {
    await audit(ctx, { action: "billing.plan_changed", resourceType: "subscription", resourceId: local.id, metadata: { provider: "stripe", planId, paymentCollected: true } });
  }
  return organizationId;
}

const INVOICE_STATUS: Record<string, "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE"> = { draft: "DRAFT", open: "OPEN", paid: "PAID", void: "VOID", uncollectible: "UNCOLLECTIBLE" };

async function recordStripeInvoice(invoice: Stripe.Invoice, eventType: string): Promise<string | null> {
  if (!invoice.id) return null;
  const organizationId = await organizationForCustomer(stripeId(invoice.customer), invoice.parent?.subscription_details?.metadata?.organizationId);
  if (!organizationId) return null;
  const status = INVOICE_STATUS[invoice.status ?? "draft"] ?? "OPEN";
  const currency = invoice.currency.toUpperCase();
  const data = {
    number: invoice.number,
    status,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    periodStart: new Date(invoice.period_start * 1000),
    periodEnd: new Date(invoice.period_end * 1000),
  };
  const row = await prisma.invoice.upsert({ where: { providerInvoiceId: invoice.id }, create: { organizationId, providerInvoiceId: invoice.id, ...data }, update: data });
  if (eventType === "invoice.paid" && invoice.amount_paid > 0) {
    await prisma.payment.upsert({
      where: { providerPaymentId: invoice.id },
      create: { organizationId, invoiceId: row.id, providerPaymentId: invoice.id, amount: invoice.amount_paid, currency, status: "SUCCEEDED" },
      update: { status: "SUCCEEDED", failureReason: null },
    });
  }
  if (eventType === "invoice.payment_failed") {
    await prisma.payment.upsert({
      where: { providerPaymentId: `${invoice.id}:attempt-${invoice.attempt_count}` },
      create: { organizationId, invoiceId: row.id, providerPaymentId: `${invoice.id}:attempt-${invoice.attempt_count}`, amount: invoice.amount_due, currency, status: "FAILED", failureReason: "The card payment failed; Stripe will retry." },
      update: {},
    });
    await audit(systemContext(organizationId), { action: "billing.payment_failed", resourceType: "invoice", resourceId: row.id, metadata: { provider: "stripe", subscription: stripeInvoiceSubscriptionId(invoice) } });
  }
  return organizationId;
}

// ----------------------------------------------------------------------------- UPI (Razorpay)

type UpiOutcome = "applied" | "already_applied" | "pending" | "failed";

async function recordFailedUpiPayment(organizationId: string, payment: RazorpayPayment): Promise<void> {
  await prisma.payment.upsert({
    where: { providerPaymentId: payment.id },
    create: { organizationId, providerPaymentId: payment.id, amount: payment.amount, currency: payment.currency, status: "FAILED", failureReason: payment.error_description?.slice(0, 300) ?? "The payment failed" },
    update: {},
  });
}

/** Applies a Razorpay payment for an order Reachly created. Safe to call twice (browser + webhook). */
async function applyUpiPayment(client: RazorpayClient, order: RazorpayOrder, payment: RazorpayPayment): Promise<UpiOutcome> {
  const organizationId = razorpayNote(order, "organizationId");
  const planKey = razorpayNote(order, "planKey");
  if (!organizationId || !planKey) throw new ValidationError("That order wasn't created by Reachly");
  if (payment.order_id !== order.id) throw new ValidationError("The payment doesn't belong to that order");
  if (payment.status === "failed") {
    await recordFailedUpiPayment(organizationId, payment);
    return "failed";
  }
  if (payment.status !== "captured" && payment.status !== "authorized") return "pending";
  if (payment.amount !== order.amount || payment.currency !== order.currency) throw new ValidationError("The amount paid doesn't match the order");
  if (payment.status === "authorized") payment = await call("razorpay", () => client.capturePayment(payment.id, payment.amount, payment.currency));

  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan) throw new NotFoundError("Plan", planKey);
  try {
    await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { organizationId } });
      if (!subscription) throw new NotFoundError("Subscription");
      const now = new Date();
      // Paying again for the same plan before the month is up adds a month; anything else starts a fresh month today.
      const extend = subscription.billingProvider === "razorpay" && subscription.planId === plan.id && subscription.currentPeriodEnd > now;
      const coversFrom = extend ? subscription.currentPeriodEnd : now;
      const periodEnd = addMonths(coversFrom, 1);
      const invoice = await tx.invoice.upsert({
        where: { providerInvoiceId: order.id },
        create: { organizationId, providerInvoiceId: order.id, number: order.receipt, status: "PAID", amountDue: order.amount, amountPaid: payment.amount, currency: payment.currency, periodStart: coversFrom, periodEnd },
        update: { status: "PAID", amountPaid: payment.amount },
      });
      // The unique payment id is the idempotency guard: a second caller fails here and rolls back.
      await tx.payment.create({ data: { organizationId, invoiceId: invoice.id, providerPaymentId: payment.id, amount: payment.amount, currency: payment.currency, status: "SUCCEEDED" } });
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { planId: plan.id, status: "ACTIVE", billingProvider: "razorpay", providerSubscriptionId: null, currentPeriodStart: extend ? subscription.currentPeriodStart : now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return "already_applied";
    throw error;
  }
  await audit(systemContext(organizationId), { action: "billing.plan_changed", resourceType: "subscription", resourceId: organizationId, metadata: { provider: "razorpay", planKey, paymentCollected: true, method: payment.method, amount: payment.amount } });
  return "applied";
}

// ----------------------------------------------------------------------------- Webhooks

/**
 * Records each provider event once (WebhookEvent is unique per provider + event id) and runs
 * the handler. Failed events are retried by the provider; processed ones are acknowledged.
 */
async function processOnce(provider: string, externalEventId: string, eventType: string, payload: Prisma.InputJsonValue, handle: () => Promise<string | null>) {
  let row = await prisma.webhookEvent.findUnique({ where: { provider_externalEventId: { provider, externalEventId } } });
  if (row && (row.status === "PROCESSED" || row.status === "IGNORED")) return { status: "duplicate" as const };
  if (!row) {
    try {
      row = await prisma.webhookEvent.create({ data: { provider, externalEventId, eventType, signatureValid: true, payload } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { status: "duplicate" as const };
      throw error;
    }
  }
  await prisma.webhookEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  try {
    const organizationId = await handle();
    await prisma.webhookEvent.update({ where: { id: row.id }, data: { status: organizationId ? "PROCESSED" : "IGNORED", organizationId, processedAt: new Date(), error: null } });
    return { status: organizationId ? ("processed" as const) : ("ignored" as const) };
  } catch (error) {
    await prisma.webhookEvent.update({ where: { id: row.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : String(error) } });
    throw error;
  }
}

export async function ingestStripeWebhook(input: { rawBody: string; signature: string | null }) {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new ProviderNotConfiguredError("Stripe webhooks", "Add STRIPE_WEBHOOK_SECRET.");
  const client = stripe();
  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(input.rawBody, input.signature ?? "", secret);
  } catch {
    throw new UnauthorizedError("Invalid Stripe signature");
  }
  const object = event.data.object as { id?: string };
  return processOnce("stripe", event.id, event.type, { type: event.type, object: object.id ?? null }, () => call("stripe", () => handleStripeEvent(client, event)));
}

async function handleStripeEvent(client: Stripe, event: Stripe.Event): Promise<string | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subscriptionId = session.mode === "subscription" ? stripeId(session.subscription) : null;
      if (!subscriptionId) return null;
      return applyStripeSubscription(await client.subscriptions.retrieve(subscriptionId), session.client_reference_id);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      // Events can arrive out of order; the current state from Stripe is the truth.
      return applyStripeSubscription(await client.subscriptions.retrieve(event.data.object.id));
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.voided":
    case "invoice.marked_uncollectible":
      return recordStripeInvoice(event.data.object, event.type);
    default:
      return null;
  }
}

export async function ingestRazorpayWebhook(input: { rawBody: string; signature: string | null; eventId: string | null }) {
  const secret = getEnv().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new ProviderNotConfiguredError("Razorpay webhooks", "Add RAZORPAY_WEBHOOK_SECRET.");
  if (!verifyRazorpayWebhookSignature(input.rawBody, input.signature, secret)) throw new UnauthorizedError("Invalid Razorpay signature");
  const event = JSON.parse(input.rawBody) as { event: string; created_at: number; payload?: { payment?: { entity?: RazorpayPayment } } };
  const payment = event.payload?.payment?.entity;
  const eventId = input.eventId ?? `${event.event}:${payment?.id ?? event.created_at}`;
  return processOnce("razorpay", eventId, event.event, { type: event.event, object: payment?.id ?? null }, async () => {
    if (!payment?.order_id) return null;
    const { client } = razorpay();
    const order = await call("razorpay", () => client.fetchOrder(payment.order_id!));
    const organizationId = razorpayNote(order, "organizationId");
    if (!organizationId) return null;
    if (event.event === "payment.failed") {
      await recordFailedUpiPayment(organizationId, payment);
      return organizationId;
    }
    if (event.event === "payment.captured" || event.event === "payment.authorized" || event.event === "order.paid") {
      await applyUpiPayment(client, order, await call("razorpay", () => client.fetchPayment(payment.id)));
      return organizationId;
    }
    return null;
  });
}
