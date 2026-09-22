import { getEnv } from "@repo/config/env";
import { assertCan, type TenantContext } from "../context";
import { PreconditionError } from "../errors";
import { paymentProviders, paymentsConfigured, upiPrice } from "./payments";
import { listPlans, resolvePlan } from "./plans";
import { changePlanWithoutPayment } from "./subscription";
import { getUsage } from "./usage";

/**
 * Everything the Billing page needs: the current plan and period, metered usage, the
 * plans on offer and invoices. Paid plans go through Stripe (card) or Razorpay (UPI) when
 * their keys are set. With neither, plan changes are applied directly outside production and
 * labelled "no payment collected".
 */
export async function getBillingOverview(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const [plan, usage, plans, invoices] = await Promise.all([resolvePlan(ctx), getUsage(ctx), listPlans(), ctx.db.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 12 })]);
  const current = plans.find((item) => item.id === plan.id);
  return {
    plan: { key: plan.key, name: plan.name, priceMonthly: current?.priceMonthly ?? 0, currency: current?.currency ?? "USD", description: current?.description ?? "" },
    subscription: {
      status: plan.subscription.status,
      provider: plan.subscription.billingProvider,
      currentPeriodStart: plan.subscription.currentPeriodStart,
      currentPeriodEnd: plan.subscription.currentPeriodEnd,
      cancelAtPeriodEnd: plan.subscription.cancelAtPeriodEnd,
    },
    usage,
    plans: plans
      .filter((item) => item.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({ key: item.key, name: item.name, description: item.description, priceMonthly: item.priceMonthly, currency: item.currency, priceMonthlyInr: upiPrice(item.key), highlighted: item.highlighted, limits: item.parsed.limits, features: item.parsed.features })),
    invoices: invoices.map((invoice) => ({ id: invoice.id, number: invoice.number, status: invoice.status, amountDue: invoice.amountDue, amountPaid: invoice.amountPaid, currency: invoice.currency, hostedInvoiceUrl: invoice.hostedInvoiceUrl, pdfUrl: invoice.pdfUrl, createdAt: invoice.createdAt })),
    paymentsConfigured: paymentsConfigured(),
    payments: paymentProviders(),
    /** Without a payment provider, can plans be switched directly? Never in production. */
    directPlanChanges: !paymentsConfigured() && (getEnv().APP_ENV !== "production" || getEnv().DEMO_MODE),
    hasCardOnFile: Boolean(plan.subscription.providerCustomerId?.startsWith("cus_")),
    canManage: ctx.role === "OWNER",
  };
}
export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;

/** Direct plan change for deployments without a payment provider (never in production). */
export async function changePlan(ctx: TenantContext, planKey: string) {
  assertCan(ctx, "billing:manage");
  if (paymentsConfigured()) throw new PreconditionError("Plan changes go through checkout when payments are configured");
  const env = getEnv();
  if (env.APP_ENV === "production" && !env.DEMO_MODE) throw new PreconditionError("Payments aren't set up yet. Add Stripe or Razorpay keys to sell plans.");
  await changePlanWithoutPayment(ctx, planKey);
  return getBillingOverview(ctx);
}
