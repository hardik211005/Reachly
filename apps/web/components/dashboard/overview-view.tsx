"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Megaphone, Sparkles, Telescope } from "lucide-react";
import { CHANNEL_LABELS, type Channel } from "@repo/config";
import type { OverviewData } from "@repo/core/analytics/overview";
import {
  AIInsightCard,
  BarChart,
  Button,
  ChartCard,
  EmptyState,
  FunnelChart,
  MetricCard,
  Reveal,
  Stagger,
  StaggerItem,
  SERIES_COLORS,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TimeSeriesChart,
  formatNumber,
  formatPercent,
} from "@repo/ui";
import { formatDay, formatKpi } from "./format";

export interface InsightSummary {
  id: string;
  title: string;
  body: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  confidence: number;
  comparisonLabel: string | null;
}

const CAMPAIGN_TONES: Record<string, "success" | "warning" | "neutral" | "muted" | "accent"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  DRAFT: "muted",
  SCHEDULED: "accent",
  COMPLETED: "neutral",
  ARCHIVED: "muted",
};

export function OverviewView({ data, currency, insights }: { data: OverviewData; currency: string; insights: InsightSummary[] }) {
  const series = data.series.map((point) => ({ ...point }));
  const activitySeries = [
    { key: "outreach", label: "Outreach sent", slot: 0 },
    { key: "replies", label: "Replies", slot: 1 },
    { key: "positive", label: "Positive replies", slot: 2 },
  ];
  const channelRows = data.channels.map((channel) => ({
    channel: CHANNEL_LABELS[channel.channel as Channel] ?? channel.channel,
    sent: channel.sent,
    replies: channel.replies,
  }));

  if (!data.hasData) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface">
        <EmptyState
          icon={Telescope}
          title="No activity yet"
          description="Every number on this page comes from real events in your workspace. Discover your first leads to get started."
          action={
            <>
              <Button asChild variant="primary">
                <Link href="/app/discover">
                  <Telescope /> Find leads
                </Link>
              </Button>
              <Button asChild>
                <Link href="/app/campaigns/new">
                  <Megaphone /> Create campaign
                </Link>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <section aria-label="Key metrics">
        <Stagger step={0.04} delay={0.1} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 *:min-w-0">
          {data.kpis.map((kpi) => (
            <StaggerItem key={kpi.key}>
              <MetricCard
                label={kpi.label}
                value={formatKpi(kpi.value, kpi.format, currency)}
                numeric={{ value: kpi.value, format: (value) => formatKpi(value, kpi.format, currency) }}
                delta={{
                  value: kpi.delta,
                  upIsGood: kpi.upIsGood,
                  label: `vs previous ${data.range.days} days (${formatKpi(kpi.previous, kpi.format, currency)})`,
                }}
                hint={kpi.hint}
                className="h-full"
              />
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <Reveal className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Outreach activity"
          description={`Daily, last ${data.range.days} days`}
          legend={activitySeries.map((item) => ({ label: item.label, color: SERIES_COLORS[item.slot] ?? SERIES_COLORS[0] }))}
          table={{
            columns: ["Date", "Leads", "Outreach", "Replies", "Positive"],
            rows: series.map((point) => [formatDay(point.date), point.leads, point.outreach, point.replies, point.positive]),
          }}
        >
          <TimeSeriesChart data={series} xKey="date" series={activitySeries} xFormat={formatDay} />
        </ChartCard>
        <ChartCard
          title="Conversion funnel"
          description="Leads reaching each stage in the period"
          table={{ columns: ["Stage", "Leads"], rows: data.funnel.map((stage) => [stage.label, stage.value]) }}
          height={260}
        >
          <div className="flex h-full flex-col justify-center">
            <FunnelChart stages={data.funnel} />
          </div>
        </ChartCard>
      </Reveal>

      <Reveal className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Lead acquisition"
          description="New leads per day"
          table={{ columns: ["Date", "New leads"], rows: series.map((point) => [formatDay(point.date), point.leads]) }}
        >
          <TimeSeriesChart data={series} xKey="date" variant="area" series={[{ key: "leads", label: "New leads", slot: 0 }]} xFormat={formatDay} />
        </ChartCard>
        <ChartCard
          title="Channel performance"
          description="Sent vs. replies by channel"
          legend={[
            { label: "Sent", color: SERIES_COLORS[0] },
            { label: "Replies", color: SERIES_COLORS[1] },
          ]}
          table={{
            columns: ["Channel", "Sent", "Replies", "Reply rate", "Positive rate"],
            rows: data.channels.map((channel) => [
              CHANNEL_LABELS[channel.channel as Channel] ?? channel.channel,
              channel.sent,
              channel.replies,
              formatPercent(channel.replyRate),
              formatPercent(channel.positiveRate),
            ]),
          }}
          empty={channelRows.length === 0 ? <p className="text-[13px] text-foreground-muted">No outreach in this period</p> : undefined}
        >
          <BarChart
            data={channelRows}
            categoryKey="channel"
            series={[
              { key: "sent", label: "Sent", slot: 0 },
              { key: "replies", label: "Replies", slot: 1 },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Lead quality"
          description="Current leads by score band"
          table={{ columns: ["Score", "Leads"], rows: data.scoreDistribution.map((bucket) => [bucket.bucket, bucket.count]) }}
          empty={data.scoreDistribution.every((bucket) => bucket.count === 0) ? <p className="text-[13px] text-foreground-muted">No scored leads yet</p> : undefined}
        >
          <BarChart data={data.scoreDistribution} categoryKey="bucket" series={[{ key: "count", label: "Leads", slot: 0 }]} />
        </ChartCard>
      </Reveal>

      <Reveal className="grid items-start gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface shadow-xs lg:col-span-2">
          <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <div>
              <h3 className="text-[13px] font-semibold">Campaign performance</h3>
              <p className="mt-0.5 text-xs text-foreground-muted">Activity attributed to each campaign in the period</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/campaigns">
                All campaigns <ArrowRight />
              </Link>
            </Button>
          </header>
          {data.campaigns.length === 0 ? (
            <EmptyState compact icon={Megaphone} title="No campaigns yet" action={<Button asChild size="sm"><Link href="/app/campaigns/new">Create campaign</Link></Button>} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Reply rate</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.campaigns.map((campaign) => (
                  <TableRow key={campaign.campaignId}>
                    <TableCell>
                      <Link href={`/app/campaigns/${campaign.campaignId}`} className="flex items-center gap-2 font-medium hover:underline">
                        {campaign.name}
                        <StatusBadge tone={CAMPAIGN_TONES[campaign.status] ?? "neutral"}>{campaign.status.toLowerCase()}</StatusBadge>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.leads)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.sent)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.replies)}</TableCell>
                    <TableCell className="text-right">{formatPercent(campaign.replyRate)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.meetings)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.won)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">AI insights</h3>
            <Button asChild variant="ghost" size="xs">
              <Link href="/app/ai-insights">
                View all <ArrowRight />
              </Link>
            </Button>
          </div>
          {insights.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface">
              <EmptyState
                compact
                icon={Sparkles}
                title="No insights yet"
                description="Insights are computed from your analytics once there's enough activity to compare — never invented."
              />
            </div>
          ) : (
            <Stagger inView step={0.08} className="grid gap-3">
              {insights.map((insight) => (
                <StaggerItem key={insight.id}>
                  <AIInsightCard
                    className="border-gradient border-transparent lift"
                    title={insight.title}
                    body={insight.body}
                    sentiment={insight.sentiment === "POSITIVE" ? "positive" : insight.sentiment === "NEGATIVE" ? "negative" : "neutral"}
                    comparison={insight.comparisonLabel ?? undefined}
                    confidence={insight.confidence}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}
          <Button asChild variant="secondary" size="sm" className="w-full">
            <Link href="/app/analytics">
              <BarChart3 /> Open analytics
            </Link>
          </Button>
        </section>
      </Reveal>
    </div>
  );
}
