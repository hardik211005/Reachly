"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Inbox, PlugZap } from "lucide-react";
import { ChartCard, CompanyMark, EmptyState, ErrorState, MetricCard, SegmentedControl, Skeleton, TimeSeriesChart, formatNumber } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { formatDay } from "../dashboard/format";
import { RelativeTime } from "../time";
import { MessageStatusBadge, ProviderPill, pct, type ProviderState } from "../outreach/shared";

export interface ChannelOverviewData {
  channel: "EMAIL" | "WHATSAPP";
  days: number;
  provider: ProviderState;
  totals: { sent: number; delivered: number; engaged: number; replied: number; failed: number; opt_outs: number };
  rates: { delivery: number | null; engagement: number | null; reply: number | null; failure: number | null };
  series: Array<{ day: string; sent: number; replied: number }>;
  suppressions: Array<{ reason: string; count: number }>;
  recent: Array<{
    id: string;
    status: string;
    lastMessageAt: string;
    unreadCount: number;
    lead: { id: string; name: string; city: string | null; locality: string | null };
    lastMessage: { body: string; direction: "OUTBOUND" | "INBOUND"; status: string; subject: string | null } | null;
  }>;
  pendingApproval: number;
  templates: Record<string, number>;
}

const SUPPRESSION_LABELS: Record<string, string> = {
  OPT_OUT: "Opted out in a reply",
  UNSUBSCRIBE: "Unsubscribed",
  BOUNCE: "Hard bounce",
  COMPLAINT: "Spam complaint",
  DND: "Do-not-disturb registry",
  MANUAL: "Added manually",
  WRONG_CONTACT: "Wrong contact",
};

export function useChannelOverview(channel: "EMAIL" | "WHATSAPP", days: number) {
  return useQuery({
    queryKey: ["channel-overview", channel, days],
    queryFn: () => api<ChannelOverviewData>(`/api/v1/channels/${channel.toLowerCase()}?days=${days}`),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function ProviderCard({ title, provider, children }: { title: string; provider: ProviderState; children?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <div className="mt-1">
            <ProviderPill state={provider} />
          </div>
        </div>
        <Link href="/app/integrations" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          {provider.ok && !provider.simulated ? "Manage" : "Connect provider"} <ArrowUpRight className="size-3" />
        </Link>
      </div>
      {!provider.ok ? (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-foreground-muted">
          <PlugZap className="mt-0.5 size-3.5 shrink-0" /> Nothing can be sent on this channel until a provider is connected.
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function ChannelDashboard({
  channel,
  labels,
  aside,
  children,
}: {
  channel: "EMAIL" | "WHATSAPP";
  labels: { engaged: string; replied: string };
  aside: (data: ChannelOverviewData) => React.ReactNode;
  children?: (data: ChannelOverviewData) => React.ReactNode;
}) {
  const [days, setDays] = React.useState("30");
  const query = useChannelOverview(channel, Number(days));

  if (query.isPending) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[84px]" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const data = query.data;
  const inboxHref = `/app/conversations?channel=${channel}`;

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          value={days}
          onValueChange={setDays}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
        {data.pendingApproval ? (
          <Link href="/app/conversations?view=review" className="text-xs font-medium text-warning-text hover:underline">
            {data.pendingApproval} awaiting review →
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Sent" value={formatNumber(data.totals.sent)} hint={`Last ${data.days} days`} />
        <MetricCard label="Delivered" value={pct(data.rates.delivery)} hint={`${formatNumber(data.totals.delivered)} messages`} />
        <MetricCard label={labels.engaged} value={pct(data.rates.engagement)} hint={`${formatNumber(data.totals.engaged)} messages`} />
        <MetricCard label={labels.replied} value={pct(data.rates.reply)} hint={`${formatNumber(data.totals.replied)} ${data.totals.replied === 1 ? "reply" : "replies"}`} />
        <MetricCard label="Failed / bounced" value={pct(data.rates.failure)} hint={`${formatNumber(data.totals.failed)} messages`} />
        <MetricCard label="Opt-outs" value={formatNumber(data.totals.opt_outs)} hint="Suppressed automatically" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4 *:min-w-0">
          <ChartCard
            title="Volume and replies"
            description={`Daily, last ${data.days} days`}
            legend={[
              { label: "Sent", color: "var(--series-1)" },
              { label: "Replies", color: "var(--series-3)" },
            ]}
            table={{ columns: ["Day", "Sent", "Replies"], rows: data.series.map((row) => [formatDay(row.day), row.sent, row.replied]) }}
            empty={data.totals.sent || data.totals.replied ? undefined : <EmptyState compact title="No activity in this period" description="Numbers appear as soon as messages are sent." />}
          >
            <TimeSeriesChart
              data={data.series}
              xKey="day"
              xFormat={formatDay}
              variant="area"
              series={[
                { key: "sent", label: "Sent", slot: 0 },
                { key: "replied", label: "Replies", slot: 2 },
              ]}
            />
          </ChartCard>
          {children?.(data)}
          <section className="rounded-lg border border-border bg-surface shadow-xs">
            <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <h3 className="text-[13px] font-semibold">Recent conversations</h3>
              <Link href={inboxHref} className="text-xs font-medium text-accent hover:underline">
                Open inbox
              </Link>
            </header>
            {data.recent.length ? (
              <ul className="divide-y divide-border">
                {data.recent.map((conversation) => (
                  <li key={conversation.id}>
                    <Link href={`/app/conversations?c=${conversation.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted/50">
                      <CompanyMark name={conversation.lead.name} className="size-7 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{conversation.lead.name}</span>
                          {conversation.unreadCount ? <span className="size-1.5 rounded-full bg-accent" aria-label="Unread" /> : null}
                        </span>
                        <span className="block truncate text-xs text-foreground-muted">
                          {conversation.lastMessage ? `${conversation.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${conversation.lastMessage.body.replace(/\s+/g, " ")}` : ""}
                        </span>
                      </span>
                      {conversation.lastMessage ? <MessageStatusBadge status={conversation.lastMessage.status} /> : null}
                      <RelativeTime value={conversation.lastMessageAt} className="hidden w-20 shrink-0 text-right text-[11px] text-foreground-muted sm:block" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={Inbox} title="No conversations yet" />
            )}
          </section>
        </div>
        <aside className="grid min-w-0 content-start gap-4 *:min-w-0">
          {aside(data)}
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h3 className="text-[13px] font-semibold">Suppression list</h3>
            <p className="mt-0.5 text-xs text-foreground-muted">Never contacted again on this channel</p>
            {data.suppressions.length ? (
              <ul className="mt-3 grid gap-1.5">
                {data.suppressions.map((item) => (
                  <li key={item.reason} className="flex items-center justify-between text-[13px]">
                    <span className="text-foreground-secondary">{SUPPRESSION_LABELS[item.reason] ?? item.reason}</span>
                    <span className="font-medium tabular">{formatNumber(item.count)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-foreground-muted">Empty — no opt-outs or bounces yet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
