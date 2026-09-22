"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, EyeOff, Lightbulb, Lock, RefreshCw, RotateCcw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { AnimatedNumber, Badge, Button, Callout, EmptyState, ErrorState, GrowBar, SegmentedControl, Skeleton, SpotlightCard, Stagger, StaggerItem, cn, formatCurrency, formatNumber, formatPercent, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { RelativeTime } from "../time";
import { PageHero } from "../page-hero";

interface InsightRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  metric: string;
  currentValue: number;
  comparisonValue: number | null;
  comparisonLabel: string | null;
  supportingData: {
    method?: string;
    p?: number;
    groups?: Array<Record<string, string | number | null>>;
    steps?: Array<{ label: string; sent: number; replied: number; replyRate: number | null }>;
    objections?: Array<{ theme: string; count: number }>;
    lostDeals?: Array<{ reason: string; count: number }>;
    deals?: Array<{ title: string; stage: string; value: number }>;
    quotes?: Array<{ number: string; company: string; total: number }>;
    facts?: Record<string, string | number>;
    draft?: { title: string; body: string };
  };
  confidence: number;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  periodStart: string;
  periodEnd: string;
  phrasedByAI: boolean;
  dismissedAt: string | null;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  channel_comparison: "Channels",
  area_comparison: "Areas",
  category_comparison: "Business types",
  campaign_comparison: "Campaigns",
  score_calibration: "Lead scoring",
  loss_reasons: "Objections",
  followup_decay: "Sequences",
  followup_value: "Sequences",
  period_change: "Trend",
  stalled_deals: "Pipeline",
  unopened_quotes: "Quotes",
};

const KIND_LINKS: Record<string, string> = {
  channel_comparison: "/app/analytics",
  area_comparison: "/app/analytics",
  category_comparison: "/app/analytics",
  campaign_comparison: "/app/campaigns",
  score_calibration: "/app/leads",
  loss_reasons: "/app/calls",
  followup_decay: "/app/campaigns",
  followup_value: "/app/campaigns",
  period_change: "/app/analytics",
  stalled_deals: "/app/crm",
  unopened_quotes: "/app/crm?tab=quotes",
};

function formatValue(metric: string, value: number | null, currency: string): string {
  if (value === null) return "—";
  if (metric.endsWith("_rate") || metric.endsWith("_share") || metric === "reply_rate_by_step") return formatPercent(value, 0);
  if (metric.endsWith("_value") && metric !== "unopened_quote_value") return formatCurrency(value, currency, { compact: value >= 100_000 });
  return formatNumber(value);
}

function confidenceLabel(confidence: number): { label: string; tone: string } {
  if (confidence >= 0.9) return { label: "High confidence", tone: "bg-good" };
  if (confidence >= 0.75) return { label: "Moderate confidence", tone: "bg-series-1" };
  return { label: "Early signal", tone: "bg-warning" };
}

function Evidence({ insight, currency }: { insight: InsightRow; currency: string }) {
  const data = insight.supportingData;
  const rows: Array<[string, string, string]> = [];
  for (const group of data.groups ?? []) {
    const n = Number(group.contacted ?? group.n ?? 0);
    const hits = group.positive ?? group.replied ?? group.hits;
    rows.push([String(group.label), `${formatNumber(Number(hits ?? 0))} of ${formatNumber(n)}`, group.rate === null || group.rate === undefined ? "—" : formatPercent(Number(group.rate), 0)]);
  }
  for (const step of data.steps ?? []) rows.push([step.label, `${formatNumber(step.replied)} of ${formatNumber(step.sent)}`, step.replyRate === null ? "—" : formatPercent(step.replyRate, 0)]);
  for (const row of data.objections ?? []) rows.push([`Objection: ${row.theme}`, formatNumber(row.count), ""]);
  for (const row of data.lostDeals ?? []) rows.push([`Lost: ${row.reason}`, formatNumber(row.count), ""]);
  for (const deal of data.deals ?? []) rows.push([deal.title, deal.stage, formatCurrency(deal.value, currency, { compact: true })]);
  for (const quote of data.quotes ?? []) rows.push([`${quote.number} · ${quote.company}`, "", formatCurrency(quote.total, currency, { compact: true })]);
  return (
    <div className="grid gap-2 rounded-md bg-surface-muted/60 p-3 text-xs">
      {data.method ? (
        <p className="text-foreground-secondary">
          <span className="font-medium text-foreground">Method:</span> {data.method}
          {typeof data.p === "number" ? ` · p = ${data.p < 0.001 ? "<0.001" : data.p.toFixed(3)}` : ""}
        </p>
      ) : null}
      {rows.length ? (
        <table className="w-full tabular">
          <tbody>
            {rows.map(([label, value, rate], index) => (
              <tr key={index} className="border-b border-border last:border-0">
                <td className="py-1 pr-3 text-foreground-secondary">{label}</td>
                <td className="py-1 pr-3 text-right text-foreground">{value}</td>
                <td className="py-1 text-right font-medium text-foreground">{rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-foreground-muted">
        Period: {new Date(insight.periodStart).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {new Date(insight.periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
        {insight.phrasedByAI ? "Worded by AI from the numbers above (checked: no new figures)" : "Worded from a template"}
      </p>
    </div>
  );
}

function InsightCard({ insight, currency, view, featured }: { insight: InsightRow; currency: string; view: "current" | "history" | "dismissed"; featured?: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const dismiss = useMutation({
    mutationFn: (dismissed: boolean) => api(`/api/v1/insights/${insight.id}/dismiss`, { method: "POST", json: { dismissed } }),
    onSuccess: (_, dismissed) => {
      toast.success(dismissed ? "Insight dismissed" : "Insight restored");
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const confidence = confidenceLabel(insight.confidence);
  const Icon = insight.sentiment === "POSITIVE" ? TrendingUp : insight.sentiment === "NEGATIVE" ? TrendingDown : Lightbulb;
  return (
    <SpotlightCard className={cn("lift flex h-full flex-col rounded-lg border bg-surface shadow-xs", featured ? "border-gradient border-transparent" : "border-border")}>
      <div className="flex items-start gap-3 p-4">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", insight.sentiment === "POSITIVE" ? "bg-success-soft text-success-text" : insight.sentiment === "NEGATIVE" ? "bg-danger-soft text-danger-text" : "bg-accent-soft text-accent-soft-foreground")}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{KIND_LABELS[insight.kind] ?? insight.kind}</Badge>
            {insight.phrasedByAI ? (
              <Badge tone="accent">
                <Sparkles /> AI worded
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-2 text-sm leading-snug font-semibold">{insight.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground-secondary">{insight.body}</p>
          <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] text-foreground-muted">{insight.metric.replace(/_/g, " ")}</p>
              <p className="text-lg leading-tight font-semibold tabular">
                <AnimatedNumber value={insight.currentValue} format={(value) => formatValue(insight.metric, value, currency)} />
                {insight.comparisonValue !== null ? <span className="ml-1.5 text-xs font-normal text-foreground-muted">{`${insight.comparisonLabel ?? "vs"} ${formatValue(insight.metric, insight.comparisonValue, currency)}`}</span> : null}
              </p>
            </div>
            <div className="min-w-36">
              <div className="flex items-center justify-between text-[11px] text-foreground-muted">
                <span>{confidence.label}</span>
                <span className="tabular">{Math.round(insight.confidence * 100)}%</span>
              </div>
              <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(insight.confidence * 100)} aria-label="Confidence">
                <GrowBar value={insight.confidence} className="mt-1 h-1.5 rounded-full bg-surface-sunken" barClassName={cn("rounded-full", confidence.tone)} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {open ? (
        <div className="px-4 pb-3">
          <Evidence insight={insight} currency={currency} />
        </div>
      ) : null}
      <footer className="mt-auto flex flex-wrap items-center gap-1 border-t border-border px-3 py-2">
        <Button size="xs" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? "Hide evidence" : "Show evidence"}
        </Button>
        {KIND_LINKS[insight.kind] ? (
          <Button size="xs" variant="ghost" asChild>
            <Link href={KIND_LINKS[insight.kind]!}>Open</Link>
          </Button>
        ) : null}
        <span className="ml-auto text-[11px] text-foreground-muted">
          <RelativeTime value={insight.createdAt} />
        </span>
        {view === "current" ? (
          <Button size="xs" variant="ghost" onClick={() => dismiss.mutate(true)} aria-label={`Dismiss: ${insight.title}`}>
            <EyeOff />
          </Button>
        ) : view === "dismissed" ? (
          <Button size="xs" variant="ghost" onClick={() => dismiss.mutate(false)}>
            <RotateCcw /> Restore
          </Button>
        ) : null}
      </footer>
    </SpotlightCard>
  );
}

export function InsightsView({ enabled, planName, currency }: { enabled: boolean; planName: string; currency: string }) {
  const queryClient = useQueryClient();
  const [view, setView] = React.useState<"current" | "history" | "dismissed">("current");
  const insights = useQuery({ queryKey: ["insights", view], queryFn: () => api<{ generatedAt: string | null; insights: InsightRow[] }>(`/api/v1/insights?view=${view}`), enabled });
  const refresh = useMutation({
    mutationFn: () => api<{ generated: number; considered: number }>("/api/v1/insights/refresh", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(result.generated ? `${result.generated} insight${result.generated === 1 ? "" : "s"} from your latest data` : "Nothing stands out yet — insights need a bit more data");
      void queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-5">
      <PageHero
        title="AI insights"
        highlight="insights"
        description="Patterns in your own results — each one computed from your data with its sample size and confidence. AI only helps with the wording."
        actions={
          enabled ? (
          <div className="flex items-center gap-3">
            {insights.data?.generatedAt ? (
              <span className="text-xs text-foreground-muted">
                Updated <RelativeTime value={insights.data.generatedAt} />
              </span>
            ) : null}
            <Button size="sm" variant="primary" loading={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw /> Refresh
            </Button>
          </div>
          ) : null
        }
      />

      {!enabled ? (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={Lock}
            title="AI insights are part of Pro and Scale"
            description={`You're on ${planName}. Insights compare your channels, areas, campaigns and sequences with proper sample sizes and tell you what's working.`}
            action={
              <Button asChild size="sm" variant="primary">
                <Link href="/app/billing">View plans</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <Callout tone="neutral" icon={Lightbulb}>
            How it works: every insight is a statistical comparison over the last 30 days — for example a two-proportion test between channels — and only appears with enough data (at least 5–8 leads per group) and confidence of 70% or more. Open the evidence to see the exact counts. Insights refresh daily.
          </Callout>
          <SegmentedControl size="sm" value={view} onValueChange={setView} options={[{ value: "current", label: "Current" }, { value: "history", label: "Earlier" }, { value: "dismissed", label: "Dismissed" }]} className="self-start" />
          {insights.isPending ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : insights.isError ? (
            <ErrorState description={errorMessage(insights.error)} onRetry={() => void insights.refetch()} />
          ) : insights.data.insights.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={view === "current" ? "No insights yet" : view === "dismissed" ? "Nothing dismissed" : "No earlier insights"}
              description={view === "current" ? "Insights appear once there's enough activity to compare — a few dozen contacted leads usually does it. Try Refresh after your next campaign." : undefined}
            />
          ) : (
            <Stagger key={view} step={0.07} className="grid gap-3 md:grid-cols-2 *:min-w-0">
              {insights.data.insights.map((insight, index) => (
                <StaggerItem key={insight.id}>
                  <InsightCard insight={insight} currency={currency} view={view} featured={view === "current" && index === 0} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </>
      )}
    </div>
  );
}
