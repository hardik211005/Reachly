"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Megaphone, Sparkles, Telescope } from "lucide-react";
import { CHANNEL_LABELS, type Channel } from "@repo/config";
import type { OverviewData } from "@repo/core/analytics/overview";
import {
  AIInsightCard,
  Button,
  EmptyState,
  MetricCard,
  Reveal,
  Stagger,
  StaggerItem,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatNumber,
  formatPercent,
} from "@repo/ui";
import { BarChart, ChartCard, FunnelChart, SERIES_COLORS, TimeSeriesChart } from "@repo/ui/charts";
import { formatDay, formatKpi } from "./format";
import { BentoTile } from "./overview-hero";

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

const TODAY_KPIS = [
  "leads",
  "qualified",
  "replies",
  "positive",
  "meetings",
  "won",
  "revenue",
  "conversion",
];

export function OverviewView({
  data,
  currency,
  insights,
}: {
  data: OverviewData;
  currency: string;
  insights: InsightSummary[];
}) {
  const series = data.series.map((point) => ({ ...point }));
  const activitySeries = [
    { key: "outreach", label: "Messages sent", slot: 0 },
    { key: "replies", label: "Replies", slot: 1 },
    { key: "positive", label: "Interested replies", slot: 2 },
  ];
  const channelRows = data.channels.map((channel) => ({
    channel: CHANNEL_LABELS[channel.channel as Channel] ?? channel.channel,
    sent: channel.sent,
    replies: channel.replies,
  }));

  // The eight numbers an owner checks daily; the rest (messages sent, calls, quotes, costs) live in Reports.
  const kpis = TODAY_KPIS.map((key) => data.kpis.find((kpi) => kpi.key === key)).filter(
    (kpi) => kpi !== undefined,
  );

  if (!data.hasData) {
    return (
      <BentoTile className="col-span-2 border-dashed md:col-span-6 xl:col-span-12">
        <EmptyState
          icon={Telescope}
          title="No activity yet"
          description="Your results will show up here once you start. Begin by finding customers near you — it takes about a minute."
          action={
            <>
              <Button asChild variant="primary">
                <Link href="/app/discover">
                  <Telescope /> Find customers
                </Link>
              </Button>
              <Button asChild>
                <Link href="/app/campaigns/new">
                  <Megaphone /> Send an offer
                </Link>
              </Button>
            </>
          }
        />
      </BentoTile>
    );
  }

  return (
    <>
      {kpis.map((kpi, index) => (
        <Reveal
          key={kpi.key}
          delay={index * 0.04}
          className="col-span-1 min-w-0 md:col-span-3 xl:col-span-3"
        >
          <MetricCard
            label={kpi.label}
            value={formatKpi(kpi.value, kpi.format, currency)}
            numeric={{
              value: kpi.value,
              format: (value) => formatKpi(value, kpi.format, currency),
            }}
            delta={{
              value: kpi.delta,
              upIsGood: kpi.upIsGood,
              label: `vs previous ${data.range.days} days (${formatKpi(kpi.previous, kpi.format, currency)})`,
            }}
            hint={kpi.hint}
            className="h-full rounded-xl"
          />
        </Reveal>
      ))}

      <Reveal className="col-span-2 min-w-0 md:col-span-6 xl:col-span-8">
        <ChartCard
          className="h-full rounded-xl"
          title="Messages & replies"
          description={`Daily, last ${data.range.days} days`}
          legend={activitySeries.map((item) => ({
            label: item.label,
            color: SERIES_COLORS[item.slot] ?? SERIES_COLORS[0],
          }))}
          table={{
            columns: ["Date", "Leads", "Outreach", "Replies", "Positive"],
            rows: series.map((point) => [
              formatDay(point.date),
              point.leads,
              point.outreach,
              point.replies,
              point.positive,
            ]),
          }}
        >
          <TimeSeriesChart data={series} xKey="date" series={activitySeries} xFormat={formatDay} />
        </ChartCard>
      </Reveal>
      <Reveal className="col-span-2 min-w-0 md:col-span-6 xl:col-span-4">
        <ChartCard
          className="h-full rounded-xl"
          title="From found to won"
          description="Leads reaching each stage in the period"
          table={{
            columns: ["Stage", "Leads"],
            rows: data.funnel.map((stage) => [stage.label, stage.value]),
          }}
          height={260}
        >
          <div className="flex h-full flex-col justify-center">
            <FunnelChart stages={data.funnel} />
          </div>
        </ChartCard>
      </Reveal>

      <Reveal className="col-span-2 min-w-0 md:col-span-3 xl:col-span-4">
        <ChartCard
          className="h-full rounded-xl"
          title="Customers found"
          description="Customers found per day"
          table={{
            columns: ["Date", "Customers found"],
            rows: series.map((point) => [formatDay(point.date), point.leads]),
          }}
        >
          <TimeSeriesChart
            data={series}
            xKey="date"
            variant="area"
            series={[{ key: "leads", label: "Customers found", slot: 0 }]}
            xFormat={formatDay}
          />
        </ChartCard>
      </Reveal>
      <Reveal className="col-span-2 min-w-0 md:col-span-3 xl:col-span-4">
        <ChartCard
          className="h-full rounded-xl"
          title="Which channel works best"
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
          empty={
            channelRows.length === 0 ? (
              <p className="text-[13px] text-foreground-muted">No outreach in this period</p>
            ) : undefined
          }
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
      </Reveal>
      <Reveal className="col-span-2 min-w-0 md:col-span-6 xl:col-span-4">
        <ChartCard
          className="h-full rounded-xl"
          title="How good your list is"
          description="Current leads by score band"
          table={{
            columns: ["Score", "Leads"],
            rows: data.scoreDistribution.map((bucket) => [bucket.bucket, bucket.count]),
          }}
          empty={
            data.scoreDistribution.every((bucket) => bucket.count === 0) ? (
              <p className="text-[13px] text-foreground-muted">No scored leads yet</p>
            ) : undefined
          }
        >
          <BarChart
            data={data.scoreDistribution}
            categoryKey="bucket"
            series={[{ key: "count", label: "Leads", slot: 0 }]}
          />
        </ChartCard>
      </Reveal>

      <Reveal className="col-span-2 min-w-0 md:col-span-6 xl:col-span-8">
        <BentoTile className="h-full">
          <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <div>
              <h3 className="text-[13px] font-semibold">How each offer is doing</h3>
              <p className="mt-0.5 text-xs text-foreground-muted">
                Activity attributed to each campaign in the period
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/campaigns">
                All campaigns <ArrowRight />
              </Link>
            </Button>
          </header>
          {data.campaigns.length === 0 ? (
            <EmptyState
              compact
              icon={Megaphone}
              title="No offers sent yet"
              action={
                <Button asChild size="sm">
                  <Link href="/app/campaigns/new">Send an offer</Link>
                </Button>
              }
            />
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
                      <Link
                        href={`/app/campaigns/${campaign.campaignId}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        {campaign.name}
                        <StatusBadge tone={CAMPAIGN_TONES[campaign.status] ?? "neutral"}>
                          {campaign.status.toLowerCase()}
                        </StatusBadge>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.leads)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.sent)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.replies)}</TableCell>
                    <TableCell className="text-right">
                      {formatPercent(campaign.replyRate)}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.meetings)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.won)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </BentoTile>
      </Reveal>
      <Reveal className="col-span-2 min-w-0 md:col-span-6 xl:col-span-4">
        <BentoTile className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Sparkles className="size-3.5 text-brand-2" /> AI insights
            </h3>
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
                    sentiment={
                      insight.sentiment === "POSITIVE"
                        ? "positive"
                        : insight.sentiment === "NEGATIVE"
                          ? "negative"
                          : "neutral"
                    }
                    comparison={insight.comparisonLabel ?? undefined}
                    confidence={insight.confidence}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}
          <Button asChild variant="secondary" size="sm" className="mt-auto w-full">
            <Link href="/app/analytics">
              <BarChart3 /> Open analytics
            </Link>
          </Button>
        </BentoTile>
      </Reveal>
    </>
  );
}
