"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Megaphone, Plus } from "lucide-react";
import type { AutomationMode, Channel } from "@repo/config";
import { getCategory } from "@repo/config/taxonomy";
import { Button, EmptyState, ErrorState, MetricCard, SegmentedControl, Skeleton, cn, formatNumber } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { AutomationModeBadge, CampaignStatusBadge, ChannelList, pct } from "../outreach/shared";

export interface CampaignListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  automationMode: AutomationMode;
  channels: Channel[];
  target: { categories?: string[]; locations?: Array<{ label: string }> };
  createdAt: string;
  launchedAt: string | null;
  audience: number;
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
  contacted: number;
  repliedLeads: number;
  replyRate: number | null;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function targetLine(campaign: CampaignListItem): string {
  const categories = (campaign.target.categories ?? []).slice(0, 2).map((category) => getCategory(category)?.label ?? category.replace(/_/g, " "));
  const places = (campaign.target.locations ?? []).slice(0, 2).map((location) => location.label);
  return [categories.join(", "), places.join(", ")].filter(Boolean).join(" · ") || campaign.description || "No targeting set";
}

function Stat({ value, label, className }: { value: React.ReactNode; label: string; className?: string }) {
  return (
    <div className={cn("text-right", className)}>
      <p className="text-[13px] font-medium text-foreground tabular">{value}</p>
      <p className="text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}

export function CampaignsList({ pendingApproval, initial }: { pendingApproval: number; initial: CampaignListItem[] }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [filter, setFilter] = React.useState<Filter>("all");
  const query = useQuery({ queryKey: ["campaigns"], queryFn: () => api<CampaignListItem[]>("/api/v1/campaigns"), initialData: initial, refetchInterval: 30_000 });

  if (query.isPending) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-[84px]" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const campaigns = query.data.filter((campaign) => campaign.status !== "ARCHIVED");
  if (!campaigns.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="A campaign turns qualified leads into personalised email, WhatsApp and call sequences — with your approval where you want it."
          action={
            canWrite ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/app/campaigns/new">
                  <Plus /> Create your first campaign
                </Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  const active = campaigns.filter((campaign) => campaign.status === "ACTIVE");
  const totals = campaigns.reduce(
    (sum, campaign) => ({
      sent: sum.sent + campaign.sent,
      replies: sum.replies + campaign.replies,
      positive: sum.positive + campaign.positive,
      contacted: sum.contacted + campaign.contacted,
      repliedLeads: sum.repliedLeads + campaign.repliedLeads,
    }),
    { sent: 0, replies: 0, positive: 0, contacted: 0, repliedLeads: 0 },
  );
  const visible = filter === "all" ? campaigns : campaigns.filter((campaign) => campaign.status === filter);
  const counts = Object.fromEntries(FILTERS.map((item) => [item.value, item.value === "all" ? campaigns.length : campaigns.filter((campaign) => campaign.status === item.value).length]));

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Active campaigns" value={active.length} hint={`${campaigns.length} total`} />
        <MetricCard label="Messages sent" value={formatNumber(totals.sent)} hint="All campaigns, all time" />
        <MetricCard
          label="Reply rate"
          value={pct(totals.contacted ? totals.repliedLeads / totals.contacted : null)}
          hint={`${formatNumber(totals.repliedLeads)} of ${formatNumber(totals.contacted)} leads · ${formatNumber(totals.positive)} positive`}
        />
        <MetricCard
          label="Awaiting your review"
          value={pendingApproval}
          hint={pendingApproval ? "Open the review queue" : "Nothing pending"}
          href={pendingApproval ? "/app/conversations?view=review" : undefined}
          className={pendingApproval ? "border-warning/50" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={FILTERS.map((item) => ({
            value: item.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                <span className="text-foreground-subtle tabular">{counts[item.value]}</span>
              </span>
            ),
          }))}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        {visible.length === 0 ? (
          <EmptyState compact title="No campaigns in this view" />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/app/campaigns/${campaign.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-muted/60 lg:grid-cols-[minmax(0,1fr)_auto_repeat(4,72px)_20px]"
                  onMouseEnter={() => router.prefetch(`/app/campaigns/${campaign.id}`)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{campaign.name}</span>
                      <CampaignStatusBadge status={campaign.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground-muted">
                      {targetLine(campaign)}
                      <span className="text-foreground-subtle">
                        {" · "}
                        {campaign.launchedAt ? (
                          <>
                            launched <RelativeTime value={campaign.launchedAt} />
                          </>
                        ) : (
                          <>
                            created <RelativeTime value={campaign.createdAt} />
                          </>
                        )}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <AutomationModeBadge mode={campaign.automationMode} />
                    <ChannelList channels={campaign.channels} className="hidden sm:inline-flex" />
                  </div>
                  <Stat value={formatNumber(campaign.audience)} label="Leads" className="hidden lg:block" />
                  <Stat value={formatNumber(campaign.sent)} label="Sent" className="hidden lg:block" />
                  <Stat value={pct(campaign.replyRate)} label="Replied" className="hidden lg:block" />
                  <Stat value={formatNumber(campaign.meetings)} label="Meetings" className="hidden lg:block" />
                  <ArrowRight className="hidden size-4 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground lg:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
