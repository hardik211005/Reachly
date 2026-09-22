"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Info, Lock } from "lucide-react";
import type { AnalyticsReport, BreakdownDimension, BreakdownRow, CohortMilestone, Metric } from "@repo/core/analytics/report";
import {
  AnimatedNumber,
  BarChart,
  Button,
  ChartCard,
  DonutChart,
  EmptyState,
  FunnelChart,
  Heatmap,
  SegmentedControl,
  Skeleton,
  Stagger,
  StaggerItem,
  TimeSeriesChart,
  Tooltip,
  cn,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@repo/ui";
import { api } from "@/lib/api-client";
import { formatChange, formatDay, formatMetric, rateLabel } from "./format";

type Detail = NonNullable<AnalyticsReport["detail"]>;

// ----------------------------------------------------------------------------- KPIs

function MetricTile({ metric, currency }: { metric: Metric; currency: string }) {
  const change = formatChange(metric.delta, metric.format);
  const direction = metric.delta === null ? 0 : metric.delta > 0.0005 ? 1 : metric.delta < -0.0005 ? -1 : 0;
  const good = direction === 0 ? null : direction > 0 === metric.upIsGood;
  return (
    <div className="spotlight lift h-full min-w-0 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-xs">
      <div className="flex items-center gap-1">
        <span className="truncate text-xs text-foreground-muted">{metric.label}</span>
        <Tooltip content={metric.definition}>
          <button type="button" aria-label={`About ${metric.label}`} className="shrink-0 text-foreground-subtle hover:text-foreground-muted">
            <Info className="size-3" />
          </button>
        </Tooltip>
      </div>
      <p className="mt-1 truncate text-xl leading-tight font-semibold tabular tracking-[-0.02em]">
        {metric.value === null ? "—" : <AnimatedNumber value={metric.value} format={(value) => formatMetric(value, metric.format, currency)} />}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
        {change ? <span className={cn("shrink-0 font-medium tabular", good === true ? "text-success-text" : good === false ? "text-danger-text" : "text-foreground-muted")}>{change}</span> : <span className="shrink-0 text-foreground-subtle">no prior data</span>}
        {metric.numerator !== undefined && metric.denominator !== undefined && metric.denominator > 0 ? (
          <span className="truncate text-foreground-muted tabular">
            {formatNumber(metric.numerator)} of {formatNumber(metric.denominator)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function MetricGroups({ report }: { report: AnalyticsReport }) {
  return (
    <div className="grid gap-5">
      {report.groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-foreground-muted uppercase">{group.label}</h2>
          <Stagger step={0.035} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6 *:min-w-0">
            {group.metrics.map((metric) => (
              <StaggerItem key={metric.key}>
                <MetricTile metric={metric} currency={report.currency} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- Trend & funnel

const TREND_VIEWS = {
  activity: { label: "Activity", series: [{ key: "outreach", label: "Outreach sent", slot: 0 }, { key: "replies", label: "Replies", slot: 1 }, { key: "positive", label: "Positive replies", slot: 2 }] },
  pipeline: { label: "Meetings & wins", series: [{ key: "meetings", label: "Meetings", slot: 3 }, { key: "won", label: "Deals won", slot: 4 }] },
  leads: { label: "Leads", series: [{ key: "leads", label: "New leads", slot: 5 }] },
  revenue: { label: "Revenue", series: [{ key: "revenue", label: "Revenue won", slot: 4 }] },
} as const;

export function TrendCard({ report }: { report: AnalyticsReport }) {
  const [view, setView] = React.useState<keyof typeof TREND_VIEWS>("activity");
  const config = TREND_VIEWS[view];
  const points = report.series.points.map((point) => ({ ...point }));
  const total = points.reduce((sum, point) => sum + config.series.reduce((inner, series) => inner + Number(point[series.key as keyof typeof point] ?? 0), 0), 0);
  const money = view === "revenue";
  return (
    <ChartCard
      title="Over time"
      description={`${report.series.bucket === "week" ? "Weekly" : "Daily"}, in ${report.timezone}`}
      actions={<SegmentedControl size="sm" value={view} onValueChange={setView} options={Object.entries(TREND_VIEWS).map(([value, item]) => ({ value: value as keyof typeof TREND_VIEWS, label: item.label }))} />}
      legend={config.series.length > 1 ? config.series.map((series) => ({ label: series.label, color: `var(--series-${series.slot + 1})` })) : undefined}
      table={{ columns: ["Date", ...config.series.map((series) => series.label)], rows: points.map((point) => [formatDay(point.date), ...config.series.map((series) => (money ? formatCurrency(Number(point[series.key as keyof typeof point]), report.currency) : formatNumber(Number(point[series.key as keyof typeof point]))))]) }}
      empty={total === 0 ? <p className="text-xs text-foreground-muted">Nothing in this period for the current filters.</p> : undefined}
      height={260}
    >
      <TimeSeriesChart data={points} xKey="date" series={[...config.series]} variant={money ? "area" : "line"} xFormat={formatDay} format={money ? (value) => formatCurrency(value, report.currency, { compact: true }) : undefined} />
    </ChartCard>
  );
}

export function FunnelCard({ report }: { report: AnalyticsReport }) {
  const steps = report.funnel;
  const contacted = steps.find((step) => step.key === "contacted")?.value ?? 0;
  const won = steps.find((step) => step.key === "won")?.value ?? 0;
  return (
    <ChartCard
      title="Conversion funnel"
      description={contacted ? `${formatPercent(won / contacted, 1)} of contacted leads were won` : "Distinct leads reaching each stage in the period"}
      table={{ columns: ["Stage", "Leads", "From previous"], rows: steps.map((step, index) => [step.label, formatNumber(step.value), index && steps[index - 1]!.value ? formatPercent(step.value / steps[index - 1]!.value, 0) : "—"]) }}
      empty={steps.every((step) => step.value === 0) ? <p className="text-xs text-foreground-muted">No lead activity in this period.</p> : undefined}
      height={260}
    >
      <div className="flex h-full flex-col justify-center">
        <FunnelChart stages={steps} />
      </div>
    </ChartCard>
  );
}

// ----------------------------------------------------------------------------- Channels & campaigns

function breakdownTable(rows: BreakdownRow[], currency: string, first: string) {
  return {
    columns: [first, "Contacted", "Replied", "Positive", "Meetings", "Won", "Revenue"],
    rows: rows.map((row) => [row.label, formatNumber(row.contacted), `${formatNumber(row.replied)} (${rateLabel(row.replyRate)})`, `${formatNumber(row.positive)} (${rateLabel(row.positiveRate)})`, formatNumber(row.meetings), formatNumber(row.won), formatCurrency(row.revenue, currency, { compact: row.revenue >= 100_000 })]),
  };
}

export function ChannelsCard({ rows, currency }: { rows: BreakdownRow[]; currency: string }) {
  const contacted = rows.filter((row) => row.contacted > 0);
  const data = contacted.map((row) => ({ channel: row.label, reply: row.replyRate ?? 0, positive: row.positiveRate ?? 0 }));
  return (
    <ChartCard
      title="Channels"
      description="Reply and positive-response rates per lead contacted on each channel"
      legend={[
        { label: "Reply rate", color: "var(--series-1)" },
        { label: "Positive rate", color: "var(--series-3)" },
      ]}
      table={breakdownTable(rows, currency, "Channel")}
      empty={contacted.length === 0 ? <p className="text-xs text-foreground-muted">No outreach in this period.</p> : undefined}
      height={220}
    >
      <BarChart
        data={data}
        categoryKey="channel"
        layout="horizontal-bars"
        categoryWidth={96}
        series={[
          { key: "reply", label: "Reply rate", slot: 0 },
          { key: "positive", label: "Positive rate", slot: 2 },
        ]}
        format={(value) => formatPercent(value, 0)}
      />
    </ChartCard>
  );
}

export function CampaignsCard({ rows, currency }: { rows: BreakdownRow[]; currency: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="px-4 pt-3.5 pb-2">
        <h3 className="text-[13px] font-semibold">Campaigns</h3>
        <p className="mt-0.5 text-xs text-foreground-muted">Lead-level results and estimated channel cost per campaign in the period</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-foreground-muted">No campaign activity in this period.</p>
      ) : (
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[640px] text-left text-xs tabular">
            <thead className="text-foreground-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 pl-2 font-medium">Campaign</th>
                <th className="py-2 pr-3 text-right font-medium">Contacted</th>
                <th className="py-2 pr-3 text-right font-medium">Reply rate</th>
                <th className="py-2 pr-3 text-right font-medium">Positive</th>
                <th className="py-2 pr-3 text-right font-medium">Meetings</th>
                <th className="py-2 pr-3 text-right font-medium">Won</th>
                <th className="py-2 pr-3 text-right font-medium">Revenue</th>
                <th className="py-2 pr-2 text-right font-medium">Channel cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="max-w-64 truncate py-2 pr-3 pl-2 font-medium text-foreground">
                    <Link href={`/app/campaigns/${row.key}`} className="hover:underline">
                      {row.label}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(row.contacted)}</td>
                  <td className="py-2 pr-3 text-right">{rateLabel(row.replyRate)}</td>
                  <td className="py-2 pr-3 text-right">
                    {formatNumber(row.positive)} <span className="text-foreground-muted">({rateLabel(row.positiveRate)})</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(row.meetings)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(row.won)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-foreground">{formatCurrency(row.revenue, currency, { compact: row.revenue >= 100_000 })}</td>
                  <td className="py-2 pr-2 text-right text-foreground-muted">{row.cost === null || row.cost === undefined ? "—" : formatCurrency(row.cost, currency, { decimals: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- Breakdown explorer

const DIMENSIONS: Array<{ value: BreakdownDimension; label: string }> = [
  { value: "area", label: "Area" },
  { value: "city", label: "City" },
  { value: "category", label: "Business type" },
  { value: "source", label: "Source" },
  { value: "score", label: "Score band" },
  { value: "fit", label: "Fit" },
];

export function BreakdownExplorer({ query, currency }: { query: string; currency: string }) {
  const [dimension, setDimension] = React.useState<BreakdownDimension>("area");
  const [metric, setMetric] = React.useState<"replyRate" | "positiveRate" | "meetingRate">("replyRate");
  const rows = useQuery({ queryKey: ["analytics-breakdown", dimension, query], queryFn: () => api<BreakdownRow[]>(`/api/v1/analytics/breakdown?dimension=${dimension}${query ? `&${query}` : ""}`), placeholderData: (previous) => previous });
  const data = (rows.data ?? []).filter((row) => row.contacted > 0).map((row) => ({ label: row.contacted < 5 ? `${row.label} (n=${row.contacted})` : row.label, value: row[metric] ?? 0 }));
  const metricLabel = { replyRate: "Reply rate", positiveRate: "Positive rate", meetingRate: "Meeting rate" }[metric];
  return (
    <ChartCard
      title="Where results come from"
      description={`${metricLabel} per contacted lead. Small groups (n < 5) are marked — read them with care.`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <SegmentedControl size="sm" value={metric} onValueChange={setMetric} options={[{ value: "replyRate", label: "Replies" }, { value: "positiveRate", label: "Positive" }, { value: "meetingRate", label: "Meetings" }]} />
        </div>
      }
      table={rows.data ? breakdownTable(rows.data, currency, DIMENSIONS.find((item) => item.value === dimension)!.label) : undefined}
      empty={rows.isPending ? <Skeleton className="h-40 w-full" /> : data.length === 0 ? <p className="text-xs text-foreground-muted">No contacted leads for these filters.</p> : undefined}
      height={Math.max(200, data.length * 30 + 30)}
    >
      <div className="flex h-full flex-col gap-2">
        <SegmentedControl size="sm" value={dimension} onValueChange={setDimension} options={DIMENSIONS} className="mx-2 self-start" />
        <div className="min-h-0 flex-1">
          <BarChart data={data} categoryKey="label" layout="horizontal-bars" categoryWidth={150} series={[{ key: "value", label: metricLabel, slot: metric === "replyRate" ? 0 : metric === "positiveRate" ? 2 : 3 }]} format={(value) => formatPercent(value, 0)} />
        </div>
      </div>
    </ChartCard>
  );
}

// ----------------------------------------------------------------------------- Timing, follow-ups, cohorts

export function HeatmapCard({ heatmap }: { heatmap: Detail["heatmap"] }) {
  return (
    <ChartCard
      title="When prospects reply"
      description={heatmap.peak ? `Busiest: ${heatmap.peak.day} around ${heatmap.peak.hour}:00 · ${formatNumber(heatmap.total)} replies` : "Replies by weekday and hour"}
      table={{ columns: ["Day", ...heatmap.columns.map((hour) => `${hour}h`)], rows: heatmap.rows.map((day, index) => [day, ...heatmap.values[index]!.map((value) => formatNumber(value))]) }}
      empty={heatmap.total === 0 ? <p className="text-xs text-foreground-muted">No replies in this period.</p> : undefined}
      height={240}
    >
      <Heatmap rows={heatmap.rows} columns={heatmap.columns} values={heatmap.values} format={(value) => `${formatNumber(value)} replies`} />
    </ChartCard>
  );
}

export function FollowUpsCard({ steps }: { steps: Detail["followUps"] }) {
  return (
    <ChartCard
      title="Replies by sequence step"
      description="Each replying lead credited to the last step they received before replying"
      table={{ columns: ["Step", "Leads sent", "Replied", "Reply rate"], rows: steps.map((step) => [step.label, formatNumber(step.sent), formatNumber(step.replied), rateLabel(step.replyRate)]) }}
      empty={steps.length === 0 ? <p className="text-xs text-foreground-muted">No sequence messages in this period.</p> : undefined}
      height={220}
    >
      <BarChart data={steps.map((step) => ({ step: step.label, rate: step.replyRate ?? 0 }))} categoryKey="step" series={[{ key: "rate", label: "Reply rate", slot: 0 }]} format={(value) => formatPercent(value, 0)} />
    </ChartCard>
  );
}

const MILESTONES: Array<{ value: CohortMilestone; label: string }> = [
  { value: "replied", label: "Replied" },
  { value: "positive", label: "Positive" },
  { value: "meeting", label: "Meeting" },
  { value: "won", label: "Won" },
];

export function CohortsCard({ initial, query }: { initial: Detail["cohorts"]; query: string }) {
  const [milestone, setMilestone] = React.useState<CohortMilestone>("replied");
  const cohorts = useQuery({
    queryKey: ["analytics-cohorts", milestone, query],
    queryFn: () => api<Detail["cohorts"]>(`/api/v1/analytics/cohorts?milestone=${milestone}${query ? `&${query}` : ""}`),
    initialData: milestone === "replied" ? initial : undefined,
    placeholderData: (previous) => previous,
  });
  const rows = cohorts.data ?? [];
  const weeks = rows[0]?.cells.length ?? 8;
  const steps = ["var(--seq-100)", "var(--seq-200)", "var(--seq-350)", "var(--seq-450)", "var(--seq-550)", "var(--seq-650)"];
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div>
          <h3 className="text-[13px] font-semibold">Cohorts by first contact</h3>
          <p className="mt-0.5 text-xs text-foreground-muted">Share of each week’s newly contacted leads that reached the milestone within N weeks</p>
        </div>
        <SegmentedControl size="sm" value={milestone} onValueChange={setMilestone} options={MILESTONES} />
      </header>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-foreground-muted">No leads were contacted in the last 8 weeks.</p>
      ) : (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-[560px] border-separate border-spacing-[3px] text-[11px] tabular">
            <thead>
              <tr className="text-foreground-muted">
                <th className="pr-2 text-left font-medium">Week of</th>
                <th className="pr-2 text-right font-medium">Leads</th>
                {Array.from({ length: weeks }, (_, index) => (
                  <th key={index} className="font-medium">
                    Wk {index}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.week}>
                  <th className="pr-2 text-left font-normal whitespace-nowrap text-foreground-secondary">{formatDay(row.week)}</th>
                  <td className="pr-2 text-right text-foreground-secondary">{row.size}</td>
                  {row.cells.map((cell, index) => (
                    <td
                      key={index}
                      className={cn("h-7 min-w-11 rounded-[3px] text-center", cell === null ? "text-foreground-subtle" : cell >= 0.45 ? "font-medium text-white" : "text-foreground")}
                      style={{ background: cell === null ? "transparent" : cell === 0 ? "var(--surface-muted)" : steps[Math.min(steps.length - 1, Math.floor(cell * steps.length))] }}
                      title={cell === null ? "Not observable yet" : `${formatPercent(cell, 0)} of ${row.size} leads`}
                    >
                      {cell === null ? "·" : formatPercent(cell, 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- Losses, quality, costs

export function LossesCard({ losses, currency }: { losses: Detail["losses"]; currency: string }) {
  const hasObjections = losses.objections.length > 0;
  return (
    <ChartCard
      title="Why deals are lost"
      description="Loss reasons on closed deals, and objection themes from analysed calls"
      table={{ columns: ["Reason", "Count", "Value"], rows: [...losses.deals.map((row) => [`Lost: ${row.reason}`, formatNumber(row.count), formatCurrency(row.value, currency, { compact: true })]), ...losses.objections.map((row) => [`Objection: ${row.theme}`, formatNumber(row.count), "—"])] }}
      empty={!losses.deals.length && !hasObjections ? <p className="text-xs text-foreground-muted">No lost deals or call objections in this period.</p> : undefined}
      height={220}
    >
      {hasObjections ? (
        <BarChart data={losses.objections.map((row) => ({ theme: row.theme, count: row.count }))} categoryKey="theme" layout="horizontal-bars" categoryWidth={160} series={[{ key: "count", label: "Objections", slot: 6 }]} />
      ) : (
        <DonutChart data={losses.deals.map((row, index) => ({ label: row.reason, value: row.count, slot: index }))} centerValue={formatNumber(losses.deals.reduce((sum, row) => sum + row.count, 0))} centerLabel="lost" />
      )}
    </ChartCard>
  );
}

export function QualityCard({ quality }: { quality: Detail["quality"] }) {
  const total = quality.scores.reduce((sum, row) => sum + row.count, 0) + quality.unscored;
  return (
    <ChartCard
      title="Lead quality"
      description={`Score distribution of ${formatNumber(total)} leads${quality.unscored ? ` (${formatNumber(quality.unscored)} not scored yet)` : ""}`}
      table={{ columns: ["Score", "Leads"], rows: quality.scores.map((row) => [row.band, formatNumber(row.count)]) }}
      empty={total === 0 ? <p className="text-xs text-foreground-muted">No leads yet.</p> : undefined}
      height={220}
    >
      <BarChart data={quality.scores.map((row) => ({ band: row.band, leads: row.count }))} categoryKey="band" series={[{ key: "leads", label: "Leads", slot: 0 }]} />
    </ChartCard>
  );
}

export function CostsCard({ report, ai }: { report: AnalyticsReport; ai: Detail["ai"] }) {
  const costs = report.costs;
  if (!costs) return null;
  const parts = [
    { label: "AI models", value: costs.ai },
    { label: "Email & WhatsApp", value: costs.messaging },
    { label: "Voice minutes", value: costs.voice },
    { label: "Plan (prorated)", value: costs.subscription },
  ];
  const money = (value: number) => formatCurrency(value, report.currency, { decimals: value < 100 ? 2 : 0 });
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">What results cost</h3>
        <p className="mt-0.5 text-xs text-foreground-muted">Estimated spend in the period · {money(costs.total)} total</p>
        <div className="mt-3 h-44">
          <DonutChart data={parts.map((part, index) => ({ ...part, slot: index }))} format={money} centerValue={money(costs.total)} centerLabel="total" />
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold">AI usage by agent</h3>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {formatNumber(ai.totalRequests)} requests{ai.cacheHitRate !== null ? ` · ${formatPercent(ai.cacheHitRate, 0)} served from cache` : ""}
        </p>
        <div className="mt-2 max-h-52 overflow-auto">
          <table className="w-full text-left text-xs tabular">
            <thead className="text-foreground-muted">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Agent</th>
                <th className="py-1.5 pr-3 text-right font-medium">Requests</th>
                <th className="py-1.5 pr-3 text-right font-medium">Tokens</th>
                <th className="py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ai.agents.map((agent) => (
                <tr key={agent.agent} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 text-foreground">{agent.label}</td>
                  <td className="py-1.5 pr-3 text-right">{formatNumber(agent.requests)}</td>
                  <td className="py-1.5 pr-3 text-right text-foreground-muted">{formatNumber(agent.tokens, { compact: true })}</td>
                  <td className="py-1.5 text-right">{agent.costUsd === 0 ? <span className="text-foreground-muted">free</span> : money(agent.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ai.agents.length && ai.agents.every((agent) => agent.costUsd === 0) ? <p className="mt-2 text-[11px] text-foreground-muted">The demo AI provider is free; costs appear once a real model provider is connected.</p> : null}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Locked

export function LockedAnalytics({ planName }: { planName: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface">
      <EmptyState
        icon={Lock}
        title="Advanced analytics"
        description={`Breakdowns by area, business type and source, reply timing, follow-up performance, cohorts, loss reasons and cost & ROI are part of Pro and Scale. You're on ${planName}.`}
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/app/billing">View plans</Link>
          </Button>
        }
      />
    </div>
  );
}
