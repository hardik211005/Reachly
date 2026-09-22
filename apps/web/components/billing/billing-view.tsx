"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CreditCard, ExternalLink, Gauge, IndianRupee, Info, Receipt, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import type { PlanFeatures, PlanLimits, UsageMetric } from "@repo/config";
import { AnimatedNumber, Aurora, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EASE_OUT, EmptyState, ErrorState, Skeleton, SpotlightCard, Spinner, Stagger, StaggerItem, cn, formatCurrency, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { PageHero } from "../page-hero";
import { useCheckout } from "./checkout";

interface Usage {
  metric: UsageMetric;
  label: string;
  unit: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
}
interface PlanOption {
  key: string;
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  /** UPI price in paise, when the plan is sold over UPI. */
  priceMonthlyInr: number | null;
  highlighted: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
}
interface Overview {
  plan: { key: string; name: string; priceMonthly: number; currency: string; description: string };
  subscription: { status: string; provider: string; currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean };
  usage: { periodStart: string; periodEnd: string; metrics: Usage[] };
  plans: PlanOption[];
  invoices: Array<{ id: string; number: string | null; status: string; amountDue: number; amountPaid: number; currency: string; hostedInvoiceUrl: string | null; pdfUrl: string | null; createdAt: string }>;
  paymentsConfigured: boolean;
  payments: { stripe: boolean; razorpay: boolean };
  directPlanChanges: boolean;
  hasCardOnFile: boolean;
  canManage: boolean;
}

const price = (cents: number, currency: string) => (cents === 0 ? "Free" : formatCurrency(cents / 100, currency, { decimals: 0 }));
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

function Meter({ item }: { item: Usage }) {
  const excluded = item.limit === 0;
  const unlimited = item.limit === null;
  const percent = unlimited || excluded ? 0 : Math.min(100, item.percent ?? 0);
  const tone = percent >= 90 ? "bg-critical" : percent >= 75 ? "bg-warning" : "bg-brand-gradient";
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", excluded && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{item.label}</p>
        {percent >= 90 ? <Badge tone="danger">Almost out</Badge> : percent >= 75 ? <Badge tone="warning">Running low</Badge> : null}
      </div>
      <p className="mt-2 text-[22px] leading-none font-semibold tracking-[-0.02em] tabular">
        <AnimatedNumber value={item.used} />
        <span className="ml-1 text-[13px] font-normal text-foreground-muted">{excluded ? "· not in plan" : unlimited ? "· unlimited" : `/ ${item.limit!.toLocaleString()}`}</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={item.limit ?? undefined} aria-valuenow={item.used}>
        <motion.div className={cn("h-full rounded-full", tone)} initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.9, ease: EASE_OUT }} />
      </div>
      <p className="mt-1.5 text-[11.5px] text-foreground-muted">{excluded ? "Upgrade to use this" : unlimited ? "No monthly cap" : `${(item.remaining ?? 0).toLocaleString()} ${item.unit} left`}</p>
    </div>
  );
}

function planHighlights(plan: PlanOption) {
  const usage = plan.limits.usage;
  const n = (value: number | null, unit: string) => (value === null ? `Unlimited ${unit}` : value === 0 ? null : `${value.toLocaleString()} ${unit}`);
  return [
    n(usage.LEAD_CREDITS, "leads / month"),
    n(usage.EMAIL_SENDS, "emails / month"),
    n(usage.WHATSAPP_MESSAGES, "WhatsApp messages"),
    n(usage.VOICE_MINUTES, "voice minutes"),
    plan.limits.resources.members === null ? "Unlimited teammates" : `${plan.limits.resources.members} teammate${plan.limits.resources.members === 1 ? "" : "s"}`,
    plan.features.aiInsights ? "AI insights & advanced analytics" : null,
    plan.features.apiAccess ? "API access" : null,
  ].filter((item): item is string => Boolean(item));
}

/** What the current subscription is paid with, and what the owner can do about it. */
function PaymentStatus({ data, onPayAgain }: { data: Overview; onPayAgain: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { subscription } = data;
  const portal = useMutation({
    mutationFn: () => api<{ url: string }>("/api/v1/billing/portal", { method: "POST" }),
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const resume = useMutation({
    mutationFn: () => api<Overview>("/api/v1/billing/cancel", { method: "DELETE" }),
    onSuccess: (next) => {
      queryClient.setQueryData(["billing"], next);
      toast.success("Your plan will keep renewing");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const end = date(subscription.currentPeriodEnd);

  if (subscription.provider === "stripe") {
    return (
      <div className="mt-3 grid justify-items-end gap-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] text-foreground-secondary">
          <CreditCard className="size-3.5" />
          {subscription.status === "PAST_DUE" ? <span className="font-medium text-critical-text">Last card payment failed — update your card</span> : subscription.cancelAtPeriodEnd ? `Paid by card · ends ${end}` : `Paid by card · renews ${end}`}
        </p>
        {data.canManage ? (
          <div className="flex flex-wrap justify-end gap-2">
            {subscription.cancelAtPeriodEnd ? (
              <Button size="sm" variant="secondary" disabled={resume.isPending} onClick={() => resume.mutate()}>
                {resume.isPending ? <Spinner className="size-3.5" /> : <RotateCcw />} Keep my plan
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
              {portal.isPending ? <Spinner className="size-3.5" /> : <ExternalLink />} Manage card & invoices
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (subscription.provider === "razorpay") {
    return (
      <div className="mt-3 grid justify-items-end gap-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] text-foreground-secondary">
          <IndianRupee className="size-3.5" /> Paid via UPI · active until {end}
        </p>
        {data.canManage && data.payments.razorpay ? (
          <Button size="sm" variant="secondary" onClick={onPayAgain}>
            <IndianRupee /> Add another month
          </Button>
        ) : null}
      </div>
    );
  }
  if (data.plan.priceMonthly > 0) return <p className="mt-2 text-[11.5px] text-warning-text">No payment collected — payments weren&apos;t set up when this plan was chosen.</p>;
  return null;
}

type DialogState = { plan: PlanOption; mode: "pay" | "direct" | "cancel" } | null;

function PlanDialog({ state, data, onClose }: { state: DialogState; data: Overview; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const checkout = useCheckout(onClose);
  const applied = (next: Overview, message: string) => {
    queryClient.setQueryData(["billing"], next);
    toast.success(message);
    onClose();
    router.refresh();
  };
  const direct = useMutation({
    mutationFn: (plan: string) => api<Overview>("/api/v1/billing/plan", { method: "POST", json: { plan } }),
    onSuccess: (next) => applied(next, `You're on ${next.plan.name} now`),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: () => api<Overview>("/api/v1/billing/cancel", { method: "POST" }),
    onSuccess: (next) => applied(next, next.subscription.cancelAtPeriodEnd ? `You'll move to Free on ${date(next.subscription.currentPeriodEnd)}` : "You're on Free now"),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const plan = state?.plan;
  const onCard = data.subscription.provider === "stripe" && data.subscription.status !== "CANCELED";

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && !checkout.pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {state && plan ? (
          state.mode === "cancel" ? (
            <>
              <DialogHeader>
                <DialogTitle>Move to {plan.name}?</DialogTitle>
                <DialogDescription>
                  {data.subscription.provider === "none"
                    ? "The change applies straight away. Your limits drop to the free plan's."
                    : `You keep ${data.plan.name} until ${date(data.subscription.currentPeriodEnd)} — nothing more is charged — then the workspace moves to ${plan.name}.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" onClick={onClose}>
                  Keep {data.plan.name}
                </Button>
                <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {cancel.isPending ? <Spinner className="size-3.5" /> : null} Move to {plan.name}
                </Button>
              </DialogFooter>
            </>
          ) : state.mode === "direct" ? (
            <>
              <DialogHeader>
                <DialogTitle>Switch to {plan.name}?</DialogTitle>
                <DialogDescription>Payments aren&apos;t set up on this server (no Stripe or Razorpay keys), so the change applies straight away and no payment is collected.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={direct.isPending} onClick={() => direct.mutate(plan.key)}>
                  {direct.isPending ? <Spinner className="size-3.5" /> : null} Switch plan
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{data.plan.key === plan.key ? `Add a month of ${plan.name}` : `Get ${plan.name}`}</DialogTitle>
                <DialogDescription>Choose how to pay. Your new limits apply as soon as the payment goes through.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-2.5">
                {data.payments.stripe ? (
                  <PayOption
                    icon={CreditCard}
                    title={onCard ? "Switch my card subscription" : "Card"}
                    detail={onCard ? "Prorated on your next invoice · same card" : "Visa, Mastercard, Amex · renews monthly, cancel anytime · via Stripe"}
                    amount={`${price(plan.priceMonthly, plan.currency)}/mo`}
                    busy={checkout.pendingProvider === "stripe"}
                    disabled={checkout.pending}
                    onClick={() => checkout.start({ plan: plan.key, provider: "stripe" })}
                  />
                ) : null}
                {data.payments.razorpay && plan.priceMonthlyInr ? (
                  <PayOption
                    icon={IndianRupee}
                    title="UPI"
                    detail="Google Pay, PhonePe, Paytm or any UPI app · one month, no auto-debit · via Razorpay"
                    amount={price(plan.priceMonthlyInr, "INR")}
                    busy={checkout.pendingProvider === "razorpay"}
                    disabled={checkout.pending}
                    onClick={() => checkout.start({ plan: plan.key, provider: "razorpay" })}
                  />
                ) : null}
              </div>
              <p className="flex items-center gap-1.5 text-[11.5px] text-foreground-muted">
                <ShieldCheck className="size-3.5" /> Card and UPI details go straight to Stripe or Razorpay — Reachly never sees them.
              </p>
            </>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PayOption({ icon: Icon, title, detail, amount, busy, disabled, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; detail: string; amount: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-accent/60 hover:bg-accent-soft/30 disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">{busy ? <Spinner className="size-4" /> : <Icon className="size-[18px]" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-[12px] leading-snug text-foreground-muted">{detail}</span>
      </span>
      <span className="shrink-0 text-right text-[15px] font-semibold tabular">{amount}</span>
      <ArrowRight className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** Stripe Checkout sends people back with ?checkout=success&session_id=…; apply it without waiting for the webhook. */
function useCheckoutReturn() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const handled = React.useRef(false);
  React.useEffect(() => {
    if (handled.current) return;
    const outcome = params.get("checkout");
    const sessionId = params.get("session_id");
    if (!outcome) return;
    handled.current = true;
    router.replace("/app/billing", { scroll: false });
    if (outcome === "cancelled") {
      toast.message("Checkout cancelled — nothing was charged");
      return;
    }
    if (outcome !== "success" || !sessionId) return;
    const id = toast.loading("Confirming your payment…");
    api<{ status: string; overview: Overview }>("/api/v1/billing/checkout/confirm", { method: "POST", json: { sessionId } })
      .then((result) => {
        queryClient.setQueryData(["billing"], result.overview);
        if (result.status === "complete") toast.success(`Payment received — you're on ${result.overview.plan.name}`, { id });
        else toast.message("Checkout isn't finished yet", { id });
        router.refresh();
      })
      .catch((error: unknown) => toast.error(errorMessage(error), { id }));
  }, [params, queryClient, router]);
}

export function BillingView() {
  const overview = useQuery({ queryKey: ["billing"], queryFn: () => api<Overview>("/api/v1/billing") });
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const close = React.useCallback(() => setDialog(null), []);
  useCheckoutReturn();

  if (overview.isError) return <ErrorState description={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  const currentIndex = data ? data.plans.findIndex((plan) => plan.key === data.plan.key) : -1;

  function choose(plan: PlanOption) {
    if (!data) return;
    if (plan.priceMonthly === 0) setDialog({ plan, mode: "cancel" });
    else if (data.paymentsConfigured) setDialog({ plan, mode: "pay" });
    else setDialog({ plan, mode: "direct" });
  }
  const canBuy = (plan: PlanOption) => data && (plan.priceMonthly === 0 || data.paymentsConfigured || data.directPlanChanges);
  const scheduledFree = data?.subscription.cancelAtPeriodEnd && data.subscription.provider !== "none";

  return (
    <div className="grid gap-6">
      <PageHero title="Billing & plan" highlight="Billing" description="Your plan, what you've used this period, and invoices. Pay by card or UPI." />
      {!data ? (
        <Skeleton className="h-[520px] rounded-xl" />
      ) : (
        <>
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative isolate overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-xs">
            <Aurora intensity={1} className="-z-10" />
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-brand-1 uppercase">Current plan</p>
                <h2 className="text-gradient mt-2 text-[34px] leading-none font-semibold tracking-[-0.03em]">{data.plan.name}</h2>
                <p className="mt-2 max-w-md text-[13.5px] text-foreground-secondary">{data.plan.description}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-foreground-muted">
                  <Badge tone={data.subscription.status === "ACTIVE" ? "success" : "warning"}>{data.subscription.status.toLowerCase().replace("_", " ")}</Badge>
                  <span>
                    Usage resets {date(data.usage.periodEnd)} · period started {date(data.usage.periodStart)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[34px] leading-none font-semibold tracking-[-0.03em] tabular">{data.subscription.provider === "razorpay" && data.plans.find((plan) => plan.key === data.plan.key)?.priceMonthlyInr ? price(data.plans.find((plan) => plan.key === data.plan.key)!.priceMonthlyInr!, "INR") : price(data.plan.priceMonthly, data.plan.currency)}</p>
                <p className="mt-1 text-[12.5px] text-foreground-muted">{data.plan.priceMonthly ? "per month" : "no card needed"}</p>
                <PaymentStatus
                  data={data}
                  onPayAgain={() => {
                    const plan = data.plans.find((item) => item.key === data.plan.key);
                    if (plan) setDialog({ plan, mode: "pay" });
                  }}
                />
              </div>
            </div>
          </motion.section>

          {!data.paymentsConfigured && data.canManage ? (
            <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-[12.5px] text-warning-text">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-semibold">Payments aren&apos;t connected.</span> Add <code className="font-mono text-[11.5px]">STRIPE_SECRET_KEY</code> for cards and/or <code className="font-mono text-[11.5px]">RAZORPAY_KEY_ID</code> + <code className="font-mono text-[11.5px]">RAZORPAY_KEY_SECRET</code> for UPI to the server&apos;s <code className="font-mono text-[11.5px]">.env</code>, then restart.{" "}
                {data.directPlanChanges ? "Until then, plans switch without payment (development only)." : "Until then, paid plans can't be bought."}
              </p>
            </div>
          ) : null}

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
              <Gauge className="size-4 text-foreground-muted" /> Usage this period
            </h2>
            <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.usage.metrics.map((item) => (
                <StaggerItem key={item.metric}>
                  <Meter item={item} />
                </StaggerItem>
              ))}
            </Stagger>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold">
                <Sparkles className="size-4 text-foreground-muted" /> Plans
              </h2>
              <Link href="/pricing#compare" className="text-[12.5px] font-medium text-foreground-secondary hover:text-foreground">
                Compare every feature →
              </Link>
            </div>
            <Stagger inView className="grid gap-3 lg:grid-cols-3">
              {data.plans.map((plan, index) => {
                const current = plan.key === data.plan.key;
                const upgrade = index > currentIndex;
                return (
                  <StaggerItem key={plan.key}>
                    <SpotlightCard className={cn("lift relative flex h-full flex-col rounded-2xl border bg-surface p-5 shadow-xs", current ? "border-gradient border-transparent shadow-[var(--brand-glow)]" : "border-border")}>
                      {current ? <span className="bg-brand-gradient absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white">Your plan</span> : null}
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                        <p className="text-right text-[18px] font-semibold tabular">
                          {price(plan.priceMonthly, plan.currency)}
                          {plan.priceMonthly ? <span className="text-[12px] font-normal text-foreground-muted"> /mo</span> : null}
                          {plan.priceMonthlyInr && data.payments.razorpay ? <span className="block text-[11.5px] font-medium text-foreground-muted">or {price(plan.priceMonthlyInr, "INR")} via UPI</span> : null}
                        </p>
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-foreground-muted">{plan.description}</p>
                      <ul className="mt-4 grid gap-1.5 text-[12.5px] text-foreground-secondary">
                        {planHighlights(plan).map((point) => (
                          <li key={point} className="flex items-start gap-2">
                            <Check className="mt-0.5 size-3.5 shrink-0 text-good" /> {point}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto pt-5">
                        {current ? (
                          <Button variant="secondary" className="w-full" disabled>
                            Current plan
                          </Button>
                        ) : !data.canManage ? (
                          <p className="text-center text-[12px] text-foreground-muted">Only owners can change the plan.</p>
                        ) : plan.priceMonthly === 0 && scheduledFree ? (
                          <Button variant="secondary" className="w-full" disabled>
                            Starts {date(data.subscription.currentPeriodEnd)}
                          </Button>
                        ) : canBuy(plan) ? (
                          <Button variant={upgrade ? "primary" : "secondary"} className="w-full" onClick={() => choose(plan)}>
                            {upgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`} {upgrade ? <ArrowRight /> : null}
                          </Button>
                        ) : (
                          <Button variant="secondary" className="w-full" disabled>
                            Payments not set up
                          </Button>
                        )}
                      </div>
                    </SpotlightCard>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            <header className="flex items-center gap-2 border-b border-border px-5 py-4">
              <Receipt className="size-4 text-foreground-muted" />
              <h2 className="text-[14px] font-semibold">Invoices</h2>
            </header>
            {data.invoices.length === 0 ? (
              <EmptyState compact icon={CreditCard} title="No invoices yet" description={data.paymentsConfigured ? "Invoices appear here after your first payment." : "Payments aren't set up on this server, so there's nothing to invoice."} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="bg-surface-muted/60 text-[11px] text-foreground-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Invoice</th>
                      <th className="px-5 py-2 font-medium">Date</th>
                      <th className="px-5 py-2 text-right font-medium">Amount</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-5 py-2.5 font-medium">{invoice.number ?? invoice.id.slice(0, 8)}</td>
                        <td className="px-5 py-2.5 text-foreground-secondary">{date(invoice.createdAt)}</td>
                        <td className="px-5 py-2.5 text-right tabular">{formatCurrency(invoice.amountDue / 100, invoice.currency.toUpperCase(), { decimals: 2 })}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone={invoice.status === "PAID" ? "success" : "warning"}>{invoice.status.toLowerCase()}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <span className="inline-flex gap-3">
                            {invoice.hostedInvoiceUrl ? (
                              <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-foreground-secondary hover:text-foreground">
                                View
                              </a>
                            ) : null}
                            {invoice.pdfUrl ? (
                              <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-foreground-secondary hover:text-foreground">
                                PDF
                              </a>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <PlanDialog state={dialog} data={data} onClose={close} />
        </>
      )}
    </div>
  );
}
