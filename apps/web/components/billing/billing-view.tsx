"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CreditCard, Gauge, Receipt, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import type { PlanFeatures, PlanLimits, UsageMetric } from "@repo/config";
import { AnimatedNumber, Aurora, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EASE_OUT, EmptyState, ErrorState, Skeleton, SpotlightCard, Spinner, Stagger, StaggerItem, cn, formatCurrency, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { PageHero } from "../page-hero";

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

export function BillingView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["billing"], queryFn: () => api<Overview>("/api/v1/billing") });
  const [switchTo, setSwitchTo] = React.useState<PlanOption | null>(null);
  const change = useMutation({
    mutationFn: (plan: string) => api<Overview>("/api/v1/billing/plan", { method: "POST", json: { plan } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["billing"], data);
      toast.success(`You're on ${data.plan.name} now`);
      setSwitchTo(null);
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (overview.isError) return <ErrorState description={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  const currentIndex = data ? data.plans.findIndex((plan) => plan.key === data.plan.key) : -1;

  return (
    <div className="grid gap-6">
      <PageHero title="Billing & plan" highlight="Billing" description="Your plan, what you've used this period, and invoices." />
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
                <p className="text-[34px] leading-none font-semibold tracking-[-0.03em] tabular">{price(data.plan.priceMonthly, data.plan.currency)}</p>
                <p className="mt-1 text-[12.5px] text-foreground-muted">{data.plan.priceMonthly ? "per month" : "no card needed"}</p>
                {data.subscription.provider === "none" && data.plan.priceMonthly > 0 ? <p className="mt-2 text-[11.5px] text-warning-text">No payment collected — payments aren&apos;t set up on this server.</p> : null}
              </div>
            </div>
          </motion.section>

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
                return (
                  <StaggerItem key={plan.key}>
                    <SpotlightCard className={cn("lift relative flex h-full flex-col rounded-2xl border bg-surface p-5 shadow-xs", current ? "border-gradient border-transparent shadow-[var(--brand-glow)]" : "border-border")}>
                      {current ? <span className="bg-brand-gradient absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white">Your plan</span> : null}
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                        <p className="text-[18px] font-semibold tabular">
                          {price(plan.priceMonthly, plan.currency)}
                          {plan.priceMonthly ? <span className="text-[12px] font-normal text-foreground-muted"> /mo</span> : null}
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
                        ) : data.paymentsConfigured ? (
                          <Button asChild variant={index > currentIndex ? "primary" : "secondary"} className="w-full">
                            <Link href="/contact?topic=sales">
                              {index > currentIndex ? "Upgrade" : "Downgrade"} <ArrowRight />
                            </Link>
                          </Button>
                        ) : (
                          <Button variant={index > currentIndex ? "primary" : "secondary"} className="w-full" onClick={() => setSwitchTo(plan)}>
                            {index > currentIndex ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
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
              <table className="w-full text-left text-[13px]">
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
                        {invoice.hostedInvoiceUrl ? (
                          <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-foreground-secondary hover:text-foreground">
                            View
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      <Dialog open={Boolean(switchTo)} onOpenChange={(open) => !open && setSwitchTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {switchTo?.name}?</DialogTitle>
            <DialogDescription>Payments aren&apos;t set up on this server, so the change applies straight away and no payment is collected. Your limits update immediately.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSwitchTo(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={change.isPending} onClick={() => switchTo && change.mutate(switchTo.key)}>
              {change.isPending ? <Spinner className="size-3.5" /> : null} Switch plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
