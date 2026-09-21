"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  CircleStop,
  Copy,
  FlaskConical,
  Inbox,
  MoreHorizontal,
  Pause,
  Play,
  Rocket,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { AUTOMATION_MODE_LABELS, CHANNEL_LABELS, type AutomationMode, type Channel } from "@repo/config";
import {
  Button,
  Callout,
  ChartCard,
  CompanyMark,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FunnelChart,
  MetricCard,
  ScoreIndicator,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TimeSeriesChart,
  Tooltip,
  cn,
  formatNumber,
  toast,
  type StatusTone,
} from "@repo/ui";
import { api, apiWithMeta, errorMessage } from "@/lib/api-client";
import { formatDay } from "../dashboard/format";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { ReviewQueue } from "../outreach/review-queue";
import { AutomationModeBadge, CampaignStatusBadge, ChannelIcon, ChannelList, TemplateText, pct, type ProviderState } from "../outreach/shared";
import { LaunchDialog } from "./launch-dialog";

// ----------------------------------------------------------------------------- Types

export interface CampaignDetailData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  automationMode: AutomationMode;
  channels: Channel[];
  offerSummary: string | null;
  pitchAngle: string | null;
  tone: string;
  minLeadScore: number;
  dailyLimits: Partial<Record<Channel, number>>;
  target: { categories?: string[]; locations?: Array<{ label: string }> };
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  steps: Array<{
    id: string;
    order: number;
    channel: Channel;
    delayDays: number;
    condition: "ALWAYS" | "NO_REPLY";
    name: string;
    subject: string | null;
    body: string;
    useAI: boolean;
    whatsappTemplate: { id: string; name: string; status: string } | null;
  }>;
}

interface CampaignStats {
  audience: number;
  byStatus: Record<string, number>;
  pendingApproval: number;
  leads: { contacted: number; opened: number; replied: number; positive: number; meetings: number };
  sent: number;
  delivered: number;
  opened: number;
  replies: number;
  positive: number;
  failed: number;
  optOuts: number;
  calls: number;
  meetings: number;
  won: number;
  revenue: number;
  rates: { delivery: number | null; open: number | null; reply: number | null; positive: number | null };
  series: Array<{ day: string; sent: number; replies: number }>;
  channels: Array<{ channel: string; sent: number; replies: number }>;
  steps: Record<string, { sent: number; pending: number; scheduled: number; failed: number }>;
}

interface CampaignLeadRow {
  id: string;
  status: string;
  nextStepOrder: number;
  nextActionAt: string | null;
  lastStepAt: string | null;
  stoppedReason: string | null;
  addedAt: string;
  nextStep: { order: number; name: string; channel: Channel } | null;
  lead: { id: string; name: string; category: string | null; city: string | null; locality: string | null; score: number | null; status: string; email: string | null; phone: string | null };
}

const MEMBER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Not started", tone: "muted" },
  IN_SEQUENCE: { label: "In sequence", tone: "accent" },
  AWAITING_APPROVAL: { label: "Awaiting review", tone: "warning" },
  REPLIED: { label: "Replied", tone: "success" },
  COMPLETED: { label: "Finished", tone: "neutral" },
  STOPPED: { label: "Stopped", tone: "muted" },
  OPTED_OUT: { label: "Opted out", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
};

// ----------------------------------------------------------------------------- Overview

function StepProgress({ campaign, stats }: { campaign: CampaignDetailData; stats: CampaignStats }) {
  const max = Math.max(1, stats.audience);
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="px-4 pt-3.5 pb-2">
        <h3 className="text-[13px] font-semibold">Sequence progress</h3>
        <p className="mt-0.5 text-xs text-foreground-muted">Messages per step, out of {formatNumber(stats.audience)} leads</p>
      </header>
      <ol className="grid gap-3 px-4 pb-4">
        {campaign.steps.map((step, index) => {
          const row = stats.steps[step.id] ?? { sent: 0, pending: 0, scheduled: 0, failed: 0 };
          const segments = [
            { value: row.sent, color: "var(--series-1)", label: "Sent" },
            { value: row.scheduled, color: "var(--seq-200)", label: "Scheduled" },
            { value: row.pending, color: "var(--status-warning)", label: "Awaiting review" },
            { value: row.failed, color: "var(--status-critical)", label: "Failed or blocked" },
          ];
          return (
            <li key={step.id} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <span className="flex size-4 items-center justify-center rounded-full border border-border text-[9px] tabular">{index + 1}</span>
                  <ChannelIcon channel={step.channel} className="size-3 text-foreground-muted" /> {step.name}
                </span>
                <span className="text-foreground-muted tabular">
                  {formatNumber(row.sent)} sent{row.pending ? ` · ${formatNumber(row.pending)} to review` : ""}
                  {row.failed ? ` · ${formatNumber(row.failed)} failed` : ""}
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={segments.map((segment) => `${segment.label}: ${segment.value}`).join(", ")}>
                {segments.map((segment) =>
                  segment.value ? <span key={segment.label} style={{ width: `${(segment.value / max) * 100}%`, background: segment.color }} className="h-full" /> : null,
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-foreground-muted">
        {[
          ["Sent", "var(--series-1)"],
          ["Scheduled", "var(--seq-200)"],
          ["Awaiting review", "var(--status-warning)"],
          ["Failed or blocked", "var(--status-critical)"],
        ].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: color }} /> {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function AudienceBreakdown({ stats }: { stats: CampaignStats }) {
  const entries = Object.entries(MEMBER_STATUS)
    .map(([status, meta]) => ({ status, ...meta, count: stats.byStatus[status] ?? 0 }))
    .filter((entry) => entry.count > 0);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h3 className="text-[13px] font-semibold">Where leads are</h3>
      <p className="mt-0.5 text-xs text-foreground-muted">Current state of every lead in this campaign</p>
      {entries.length ? (
        <ul className="mt-3 grid gap-2">
          {entries.map((entry) => (
            <li key={entry.status} className="grid grid-cols-[120px_minmax(0,1fr)_40px] items-center gap-3 text-xs">
              <StatusBadge tone={entry.tone}>{entry.label}</StatusBadge>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(entry.count / Math.max(1, stats.audience)) * 100}%` }} />
              </div>
              <span className="text-right font-medium tabular">{formatNumber(entry.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-foreground-muted">No leads yet.</p>
      )}
    </section>
  );
}

function OverviewTab({ campaign, stats }: { campaign: CampaignDetailData; stats: CampaignStats | undefined }) {
  if (!stats) {
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
  const funnel = [
    { label: "Leads", value: stats.audience },
    { label: "Contacted", value: stats.leads.contacted },
    { label: "Opened / read", value: stats.leads.opened },
    { label: "Replied", value: stats.leads.replied },
    { label: "Positive", value: stats.leads.positive },
    { label: "Meeting", value: stats.leads.meetings },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Leads" value={formatNumber(stats.audience)} hint={`${formatNumber(stats.byStatus.IN_SEQUENCE ?? 0)} in sequence`} />
        <MetricCard label="Sent" value={formatNumber(stats.sent)} hint={stats.failed ? `${formatNumber(stats.failed)} failed` : "No failures"} />
        <MetricCard label="Delivered" value={pct(stats.rates.delivery)} hint={`${formatNumber(stats.delivered)} messages`} />
        <MetricCard label="Opened / read" value={pct(stats.rates.open)} hint={`${formatNumber(stats.leads.opened)} of ${formatNumber(stats.leads.contacted)} leads`} />
        <MetricCard label="Reply rate" value={pct(stats.rates.reply)} hint={`${formatNumber(stats.leads.replied)} leads · ${formatNumber(stats.leads.positive)} positive`} />
        <MetricCard label="Opt-outs" value={formatNumber(stats.optOuts)} hint="Suppressed automatically" />
      </div>
      <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartCard
          title="Sends and replies"
          description={campaign.launchedAt ? "Daily, since launch" : "Daily"}
          legend={[
            { label: "Sent", color: "var(--series-1)" },
            { label: "Replies", color: "var(--series-3)" },
          ]}
          table={{ columns: ["Day", "Sent", "Replies"], rows: stats.series.map((row) => [formatDay(row.day), row.sent, row.replies]) }}
          empty={stats.sent ? undefined : <EmptyState compact title="No sends yet" description="Activity appears here once the first messages go out." />}
        >
          <TimeSeriesChart
            data={stats.series}
            xKey="day"
            xFormat={formatDay}
            series={[
              { key: "sent", label: "Sent", slot: 0 },
              { key: "replies", label: "Replies", slot: 2 },
            ]}
          />
        </ChartCard>
        <ChartCard title="Funnel" description="From audience to meetings" table={{ columns: ["Stage", "Count"], rows: funnel.map((stage) => [stage.label, stage.value]) }} height={200}>
          <div className="pt-2">
            <FunnelChart stages={funnel} />
          </div>
        </ChartCard>
      </div>
      <div className="grid gap-4 *:min-w-0 xl:grid-cols-2">
        <StepProgress campaign={campaign} stats={stats} />
        <AudienceBreakdown stats={stats} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Audience

function AudienceTab({ campaign }: { campaign: CampaignDetailData }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [status, setStatus] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const query = useQuery({
    queryKey: ["campaign-leads", campaign.id, status, page],
    queryFn: () => apiWithMeta<CampaignLeadRow[], { total: number; pageSize: number }>(`/api/v1/campaigns/${campaign.id}/leads?page=${page}&pageSize=25${status === "all" ? "" : `&status=${status}`}`),
    placeholderData: (previous) => previous,
  });
  const remove = useMutation({
    mutationFn: (leadId: string) => api(`/api/v1/campaigns/${campaign.id}/leads?leadId=${leadId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Removed from campaign — pending messages canceled");
      void queryClient.invalidateQueries({ queryKey: ["campaign-leads", campaign.id] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-stats", campaign.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "IN_SEQUENCE", label: "In sequence" },
            { value: "AWAITING_APPROVAL", label: "Review" },
            { value: "REPLIED", label: "Replied" },
            { value: "COMPLETED", label: "Finished" },
            { value: "OPTED_OUT", label: "Opted out" },
          ]}
        />
        {canWrite && !["COMPLETED", "ARCHIVED"].includes(campaign.status) ? (
          <Button asChild size="sm" variant="secondary">
            <Link href="/app/leads">
              <Users /> Add leads
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60 text-left text-xs text-foreground-muted">
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Next step</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">Last touch</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody className={cn("divide-y divide-border", query.isFetching && "opacity-70")}>
            {query.isPending
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={index}>
                    <td colSpan={5} className="px-4 py-2.5">
                      <Skeleton className="h-6" />
                    </td>
                  </tr>
                ))
              : rows.map((row) => {
                  const meta = MEMBER_STATUS[row.status] ?? { label: row.status, tone: "neutral" as const };
                  return (
                    <tr key={row.id} className="hover:bg-surface-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/app/leads/${row.lead.id}`} className="flex items-center gap-2.5">
                          <CompanyMark name={row.lead.name} className="size-7 text-[10px]" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium hover:underline">{row.lead.name}</span>
                            <span className="block truncate text-xs text-foreground-muted">{[row.lead.locality, row.lead.city].filter(Boolean).join(", ")}</span>
                          </span>
                          <ScoreIndicator score={row.lead.score} size="sm" className="ml-auto" />
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.stoppedReason ? (
                          <Tooltip content={row.stoppedReason}>
                            <span>
                              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                            </span>
                          </Tooltip>
                        ) : (
                          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-foreground-secondary md:table-cell">
                        {row.nextStep && ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"].includes(row.status) ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ChannelIcon channel={row.nextStep.channel} className="size-3 text-foreground-muted" /> {row.nextStep.name}
                            {row.nextActionAt ? (
                              <span className="text-foreground-muted">
                                · <RelativeTime value={row.nextActionAt} />
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-foreground-subtle">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-foreground-muted lg:table-cell">{row.lastStepAt ? <RelativeTime value={row.lastStepAt} /> : "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        {canWrite && ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"].includes(row.status) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${row.lead.name}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem destructive onSelect={() => remove.mutate(row.lead.id)}>
                                <CircleStop /> Remove from campaign
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!query.isPending && rows.length === 0 ? <EmptyState compact icon={Users} title="No leads in this view" /> : null}
        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-foreground-muted">
            <span>
              {formatNumber(total)} leads · page {page} of {pages}
            </span>
            <div className="flex gap-1">
              <Button size="xs" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="xs" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Sequence & settings

function SequenceTab({ campaign, stats }: { campaign: CampaignDetailData; stats: CampaignStats | undefined }) {
  return (
    <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
      <ol className="grid gap-0">
        {campaign.steps.map((step, index) => {
          const row = stats?.steps[step.id];
          return (
            <li key={step.id} className="relative pl-10">
              <span aria-hidden className={cn("absolute top-0 left-[15px] w-px bg-border", index === campaign.steps.length - 1 ? "h-4" : "h-full")} />
              <span className="absolute top-3 left-0 flex size-[31px] items-center justify-center rounded-full border border-border bg-background text-xs font-semibold tabular">{index + 1}</span>
              {index > 0 ? (
                <p className="pt-1 pb-2 text-xs text-foreground-muted">
                  Wait {step.delayDays} day{step.delayDays === 1 ? "" : "s"}
                  {step.condition === "NO_REPLY" ? ", if no reply" : ""}
                </p>
              ) : (
                <p className="pt-1 pb-2 text-xs text-foreground-muted">On launch</p>
              )}
              <div className="mb-4 rounded-lg border border-border bg-surface shadow-xs">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  <ChannelIcon channel={step.channel} className="text-foreground-muted" />
                  <span className="text-[13px] font-semibold">{step.name}</span>
                  <span className="text-xs text-foreground-muted">{CHANNEL_LABELS[step.channel]}</span>
                  {step.useAI && (step.channel === "EMAIL" || step.channel === "WHATSAPP") ? (
                    <span className="inline-flex items-center gap-1 text-xs text-accent">
                      <Sparkles className="size-3" /> AI personalised
                    </span>
                  ) : null}
                  {row ? <span className="ml-auto text-xs text-foreground-muted tabular">{formatNumber(row.sent)} sent</span> : null}
                </div>
                <div className="grid gap-2 px-4 py-3">
                  {step.subject ? <p className="text-[13px] font-medium">{step.subject}</p> : null}
                  <TemplateText text={step.body} />
                  {step.channel === "WHATSAPP" ? (
                    <p className="text-xs text-foreground-muted">
                      Template: {step.whatsappTemplate ? `${step.whatsappTemplate.name} (${step.whatsappTemplate.status.toLowerCase()})` : "none — sends only inside a 24-hour reply window"}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <aside className="grid content-start gap-3">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
          <h3 className="text-[13px] font-semibold">Settings</h3>
          <dl className="mt-3 grid gap-2.5 text-[13px]">
            <div>
              <dt className="text-xs text-foreground-muted">Mode</dt>
              <dd>{AUTOMATION_MODE_LABELS[campaign.automationMode].label}</dd>
            </div>
            <div>
              <dt className="text-xs text-foreground-muted">Offer</dt>
              <dd className="text-foreground-secondary">{campaign.offerSummary ?? "From business profile"}</dd>
            </div>
            {campaign.pitchAngle ? (
              <div>
                <dt className="text-xs text-foreground-muted">Pitch angle</dt>
                <dd className="text-foreground-secondary">{campaign.pitchAngle}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-foreground-muted">Tone</dt>
              <dd className="capitalize">{campaign.tone}</dd>
            </div>
            <div>
              <dt className="text-xs text-foreground-muted">Daily limits</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {campaign.channels.map((channel) => (
                  <span key={channel} className="inline-flex items-center gap-1 text-foreground-secondary">
                    <ChannelIcon channel={channel} className="size-3" /> {campaign.dailyLimits[channel] ?? "—"}/day
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground-muted">Minimum lead score</dt>
              <dd>{campaign.minLeadScore}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------------------- Page

export function CampaignDetail({ initial, providers }: { initial: CampaignDetailData; providers: { EMAIL: ProviderState; WHATSAPP: ProviderState } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const campaignQuery = useQuery({
    queryKey: ["campaign", initial.id],
    queryFn: () => api<CampaignDetailData>(`/api/v1/campaigns/${initial.id}`),
    initialData: initial,
  });
  const campaign = campaignQuery.data;
  const stats = useQuery({
    queryKey: ["campaign-stats", campaign.id],
    queryFn: () => api<CampaignStats>(`/api/v1/campaigns/${campaign.id}/stats`),
    refetchInterval: campaign.status === "ACTIVE" ? 10_000 : false,
  });
  const [tab, setTab] = React.useState("overview");
  const [launchOpen, setLaunchOpen] = React.useState(() => searchParams.get("launch") === "1" && initial.status === "DRAFT");

  const action = useMutation({
    mutationFn: (name: "pause" | "resume" | "complete" | "archive" | "duplicate") => api<{ id?: string; status?: string }>(`/api/v1/campaigns/${campaign.id}/${name}`, { method: "POST" }),
    onSuccess: (result, name) => {
      if (name === "duplicate" && result.id) {
        toast.success("Campaign duplicated as a draft");
        router.push(`/app/campaigns/${result.id}`);
        return;
      }
      toast.success({ pause: "Campaign paused — nothing more will be sent", resume: "Campaign resumed", complete: "Campaign completed", archive: "Campaign archived", duplicate: "" }[name]);
      void queryClient.invalidateQueries({ queryKey: ["campaign", campaign.id] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-stats", campaign.id] });
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaign.id}`, { method: "DELETE" }),
    onSuccess: () => router.push("/app/campaigns"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pending = stats.data?.pendingApproval ?? 0;
  const simulated = campaign.channels.filter((channel) => (channel === "EMAIL" || channel === "WHATSAPP") && providers[channel].simulated);
  const place = (campaign.target.locations ?? []).map((location) => location.label).join(", ");

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/app/campaigns" className="mb-3 inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
          <ArrowLeft className="size-3" /> Campaigns
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">{campaign.name}</h1>
              <CampaignStatusBadge status={campaign.status} />
              <AutomationModeBadge mode={campaign.automationMode} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-foreground-muted">
              <ChannelList channels={campaign.channels} />
              {campaign.description ? <span>{campaign.description}</span> : null}
              {place ? <span>{place}</span> : null}
              <span>
                {campaign.launchedAt ? (
                  <>
                    Launched <RelativeTime value={campaign.launchedAt} />
                  </>
                ) : (
                  <>
                    Created <RelativeTime value={campaign.createdAt} />
                  </>
                )}
              </span>
            </p>
          </div>
          {canWrite ? (
            <div className="flex shrink-0 items-center gap-2">
              {campaign.status === "DRAFT" || campaign.status === "SCHEDULED" ? (
                <Button variant="primary" size="sm" onClick={() => setLaunchOpen(true)}>
                  <Rocket /> Review & launch
                </Button>
              ) : null}
              {campaign.status === "ACTIVE" ? (
                <Button size="sm" onClick={() => action.mutate("pause")} disabled={action.isPending}>
                  <Pause /> Pause
                </Button>
              ) : null}
              {campaign.status === "PAUSED" ? (
                <Button variant="primary" size="sm" onClick={() => action.mutate("resume")} disabled={action.isPending}>
                  <Play /> Resume
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="More campaign actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => action.mutate("duplicate")}>
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                  {["ACTIVE", "PAUSED"].includes(campaign.status) ? (
                    <DropdownMenuItem onSelect={() => window.confirm("Complete this campaign? Remaining steps and queued messages are canceled.") && action.mutate("complete")}>
                      <CheckCheck /> Mark completed
                    </DropdownMenuItem>
                  ) : null}
                  {campaign.status !== "ACTIVE" && campaign.status !== "ARCHIVED" ? (
                    <DropdownMenuItem onSelect={() => action.mutate("archive")}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  ) : null}
                  {campaign.status !== "ACTIVE" ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => window.confirm("Delete this campaign? Its history stays in analytics.") && remove.mutate()}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>

      {campaign.status === "DRAFT" ? (
        <Callout
          tone="accent"
          icon={Rocket}
          title="Ready when you are"
          action={
            canWrite ? (
              <Button size="sm" variant="primary" onClick={() => setLaunchOpen(true)}>
                Review & launch
              </Button>
            ) : null
          }
        >
          This campaign is a draft. You’ll see the volume, reachability and cost estimate before confirming — nothing is sent until then.
        </Callout>
      ) : null}
      {campaign.status === "PAUSED" ? (
        <Callout tone="warning" icon={Pause}>
          Paused — no messages are sent and no steps advance. Approved messages wait and go out when you resume.
        </Callout>
      ) : null}
      {simulated.length && campaign.status !== "DRAFT" ? (
        <Callout tone="warning" icon={FlaskConical}>
          {simulated.map((channel) => CHANNEL_LABELS[channel]).join(" and ")} {simulated.length === 1 ? "runs" : "run"} through demo providers: messages aren’t delivered, and opens and replies are simulated so you can see the full flow.
        </Callout>
      ) : null}
      {pending > 0 && tab !== "review" ? (
        <Callout
          tone="warning"
          icon={Inbox}
          title={`${pending} message${pending === 1 ? "" : "s"} waiting for your review`}
          action={
            <Button size="sm" onClick={() => setTab("review")}>
              Review now
            </Button>
          }
        >
          {campaign.automationMode === "MANUAL" ? "Manual mode: every message is a draft until you send it." : "Nothing goes out until you approve it."}
        </Callout>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {pending ? <span className="rounded-full bg-warning-soft px-1.5 text-[10px] font-semibold text-warning-text tabular">{pending}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="audience">
            Audience <span className="text-foreground-subtle tabular">{stats.data ? formatNumber(stats.data.audience) : ""}</span>
          </TabsTrigger>
          <TabsTrigger value="sequence">Sequence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OverviewTab campaign={campaign} stats={stats.data} />
        </TabsContent>
        <TabsContent value="review" className="pt-4">
          <ReviewQueue campaignId={campaign.id} />
        </TabsContent>
        <TabsContent value="audience" className="pt-4">
          <AudienceTab campaign={campaign} />
        </TabsContent>
        <TabsContent value="sequence" className="pt-4">
          <SequenceTab campaign={campaign} stats={stats.data} />
        </TabsContent>
      </Tabs>

      <LaunchDialog campaignId={campaign.id} campaignName={campaign.name} open={launchOpen} onOpenChange={setLaunchOpen} />
    </div>
  );
}
