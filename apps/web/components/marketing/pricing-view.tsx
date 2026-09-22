"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, CreditCard, Minus } from "lucide-react";
import { motion } from "motion/react";
import { AUTOMATION_MODE_LABELS, CHANNEL_LABELS, USAGE_METRIC_LABELS, USAGE_METRICS, type PlanDefinition, type PlanFeatureKey } from "@repo/config";
import { Button, Reveal, cn } from "@repo/ui";
import { Pricing } from "./sections";
import { PRICING_FAQS } from "./site";
import { CtaBand, FaqSection, PageIntro, SectionHeading } from "./ui";

type Cell = string | boolean;
interface Row {
  label: string;
  hint?: string;
  value: (plan: PlanDefinition) => Cell;
}

const number = (value: number | null) => (value === null ? "Unlimited" : value.toLocaleString("en-US"));

const FEATURE_ROWS: Array<{ key: PlanFeatureKey; label: string; hint?: string }> = [
  { key: "aiQualification", label: "AI lead qualification", hint: "Scores with reasons for every lead" },
  { key: "csvImport", label: "CSV import" },
  { key: "crm", label: "CRM pipeline, tasks and meetings" },
  { key: "quotes", label: "Quotes with PDF and online acceptance" },
  { key: "voiceAgent", label: "AI voice agent" },
  { key: "workflows", label: "Workflows" },
  { key: "n8n", label: "n8n integration" },
  { key: "copilot", label: "AI copilot" },
  { key: "advancedAnalytics", label: "Advanced analytics", hint: "Cohorts, heatmaps, costs and ROI" },
  { key: "aiInsights", label: "AI insights" },
  { key: "apiAccess", label: "API access" },
  { key: "outboundWebhooks", label: "Outbound webhooks" },
  { key: "priorityProcessing", label: "Priority processing" },
];

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: "Monthly allowance",
    rows: USAGE_METRICS.map((metric) => ({
      label: USAGE_METRIC_LABELS[metric].label,
      value: (plan: PlanDefinition) => {
        const limit = plan.limits.usage[metric];
        return limit === 0 ? false : number(limit);
      },
    })),
  },
  {
    title: "Workspace",
    rows: [
      { label: "Team members", value: (plan) => number(plan.limits.resources.members) },
      { label: "Active campaigns", value: (plan) => (plan.limits.resources.activeCampaigns === 0 ? false : number(plan.limits.resources.activeCampaigns)) },
      { label: "Workflows", value: (plan) => (plan.limits.resources.workflows === 0 ? false : number(plan.limits.resources.workflows)) },
      { label: "Results per discovery search", value: (plan) => number(plan.limits.resources.discoveryResultsPerSearch) },
      { label: "Saved searches", value: (plan) => number(plan.limits.resources.savedSearches) },
    ],
  },
  {
    title: "Outreach",
    rows: [
      { label: "Channels", value: (plan) => plan.features.channels.map((channel) => CHANNEL_LABELS[channel]).join(", ") },
      { label: "Automation modes", value: (plan) => plan.features.automationModes.map((mode) => AUTOMATION_MODE_LABELS[mode].label).join(", ") },
    ],
  },
  { title: "Features", rows: FEATURE_ROWS.map((row) => ({ label: row.label, hint: row.hint, value: (plan: PlanDefinition) => plan.features[row.key] as boolean })) },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto size-4 text-good" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto size-4 text-foreground-subtle" aria-label="Not included" />;
  return <span className="text-[13px] text-foreground-secondary">{value}</span>;
}

function CompareTable({ plans }: { plans: PlanDefinition[] }) {
  const [highlight, setHighlight] = React.useState<string | null>(plans.find((plan) => plan.highlighted)?.key ?? null);
  return (
    <section id="compare" className="scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Compare plans" title="Every limit and feature, side by side" highlight="side by side" description="Numbers come straight from the plan configuration the product enforces." />
        <Reveal className="mt-12 overflow-x-auto rounded-2xl border border-border bg-surface shadow-xs">
          <table className="w-full min-w-[640px] border-collapse text-left" onMouseLeave={() => setHighlight(plans.find((plan) => plan.highlighted)?.key ?? null)}>
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface/95 backdrop-blur">
                <th scope="col" className="w-[34%] px-5 py-4 text-[12px] font-semibold tracking-wide text-foreground-muted uppercase">
                  Plan
                </th>
                {plans.map((plan) => (
                  <th key={plan.key} scope="col" className="relative px-4 py-4 text-center" onMouseEnter={() => setHighlight(plan.key)}>
                    {highlight === plan.key ? <motion.span layoutId="compare-column" className="bg-brand-gradient absolute inset-x-3 top-0 h-0.5 rounded-full" /> : null}
                    <span className="block text-[15px] font-semibold">{plan.name}</span>
                    <span className="mt-0.5 block text-[12.5px] text-foreground-muted">{plan.priceMonthly === 0 ? "Free" : `$${Math.round(plan.priceMonthly / 100)} / month`}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th colSpan={plans.length + 1} scope="colgroup" className="bg-surface-muted/60 px-5 py-2.5 text-[12px] font-semibold tracking-wide text-foreground-secondary uppercase">
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label} className="border-t border-border transition-colors hover:bg-surface-muted/40">
                    <th scope="row" className="px-5 py-3 text-[13.5px] font-medium">
                      {row.label}
                      {row.hint ? <span className="block text-[12px] font-normal text-foreground-muted">{row.hint}</span> : null}
                    </th>
                    {plans.map((plan) => (
                      <td key={plan.key} className={cn("px-4 py-3 text-center transition-colors", highlight === plan.key && "bg-accent-soft/30")} onMouseEnter={() => setHighlight(plan.key)}>
                        <CellValue value={row.value(plan)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t border-border">
                <td className="px-5 py-4" />
                {plans.map((plan) => (
                  <td key={plan.key} className="px-4 py-4 text-center">
                    <Button asChild size="sm" variant={plan.highlighted ? "primary" : "secondary"}>
                      <Link href={`/signup?plan=${plan.key}`}>{plan.priceMonthly === 0 ? "Start free" : `Choose ${plan.name}`}</Link>
                    </Button>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </Reveal>
      </div>
    </section>
  );
}

export function PricingPageView({ plans }: { plans: PlanDefinition[] }) {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Pricing" }]}
        eyebrow="Pricing"
        icon={CreditCard}
        title="Start free. Upgrade when it’s paying for itself."
        highlight="paying for itself"
        description="Plans differ by volume and automation. Every plan includes the lead engine, the CRM and full data export — and you can change plans at any time."
        center
      />
      <div className="-mt-8">
        <Pricing plans={plans} heading={false} compareLink={false} />
      </div>
      <CompareTable plans={plans} />
      <section className="px-4 sm:px-6">
        <Reveal className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Need higher limits or a custom setup?</h2>
            <p className="mt-1 text-[14px] text-foreground-secondary">Tell us about your volumes and channels and we&apos;ll put together a plan.</p>
          </div>
          <Button asChild variant="secondary" size="lg">
            <Link href="/contact?topic=sales">
              Talk to sales <ArrowRight />
            </Link>
          </Button>
        </Reveal>
      </section>
      <FaqSection items={PRICING_FAQS} title="Pricing, answered" />
      <CtaBand />
    </>
  );
}
