"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleAlert, FlaskConical, PhoneCall, Plus, Radio, Settings2 } from "lucide-react";
import { CALL_OUTCOME_LABELS, type CallOutcome } from "@repo/config";
import {
  Button,
  Callout,
  ChartCard,
  CompanyMark,
  DonutChart,
  EmptyState,
  ErrorState,
  MetricCard,
  SegmentedControl,
  Skeleton,
  TimeSeriesChart,
  cn,
  formatNumber,
} from "@repo/ui";
import { PageHero } from "../page-hero";
import { api, apiWithMeta, errorMessage } from "@/lib/api-client";
import { formatDay } from "../dashboard/format";
import { useCanManage, useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { pct } from "../outreach/shared";
import { CancelCallButton, StartCallButton } from "./call-actions";
import { CallingSetupDialog, type CallingSettings } from "./calling-setup";
import { CallStatusBadge, CallTypeLabel, ElapsedTimer, NewCallDialog, OutcomeBadge, formatDuration, type CallStatus } from "./shared";

export interface CallReadiness {
  ready: boolean;
  checks: Array<{ key: string; label: string; ok: boolean; detail: string; fix: "settings" | "integrations" | "billing" | null }>;
  provider: { ok: boolean; provider: string | null; simulated: boolean; hostedAgent: boolean };
  settings: CallingSettings;
  minutesRemaining: number | null;
}

interface CallStats {
  placed: number;
  connected: number;
  connectRate: number | null;
  positiveRate: number | null;
  avgDurationSeconds: number | null;
  minutes: number;
  costUsd: number;
  meetings: number;
  outcomes: Array<{ outcome: string; count: number }>;
  series: Array<{ day: string; placed: number; connected: number }>;
  queue: number;
  live: number;
}

export interface CallRow {
  id: string;
  type: "AI_AGENT" | "MANUAL";
  status: CallStatus;
  outcome: CallOutcome | null;
  toNumber: string | null;
  durationSeconds: number | null;
  sentiment: string | null;
  summary: string | null;
  brief: { objective?: string; opening?: string } | null;
  scheduledFor: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  createdAt: string;
  metadata: { simulated?: boolean } | null;
  lead: { id: string; name: string; city: string | null; locality: string | null; score: number | null; category: string | null };
  campaign: { id: string; name: string } | null;
}

type View = "queue" | "live" | "history";

function Readiness({ readiness, onSetup }: { readiness: CallReadiness; onSetup: (() => void) | null }) {
  const failing = readiness.checks.filter((check) => !check.ok);
  if (!failing.length) {
    return readiness.provider.simulated ? (
      <Callout tone="warning" icon={FlaskConical}>
        Demo voice provider — AI calls are simulated end to end (ringing, conversation, transcript, analysis) and labelled. Connect Vapi or Twilio in Integrations to call real numbers.
      </Callout>
    ) : null;
  }
  return (
    <section className="rounded-lg border border-warning/40 bg-surface shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <CircleAlert className="size-4 text-warning-text" /> Finish calling setup
          </h2>
          <p className="text-xs text-foreground-muted">AI calls stay off until every check passes. Manual calls with a brief work already.</p>
        </div>
        {onSetup ? (
          <Button size="sm" variant="primary" onClick={onSetup}>
            <Settings2 /> Calling setup
          </Button>
        ) : (
          <span className="text-xs text-foreground-muted">Ask a workspace admin to finish setup.</span>
        )}
      </header>
      <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {readiness.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2.5 bg-surface px-4 py-3">
            {check.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" />}
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{check.label}</p>
              <p className="text-xs text-foreground-muted">{check.detail}</p>
              {!check.ok && check.fix === "integrations" ? (
                <Link href="/app/integrations" className="text-xs font-medium text-accent hover:underline">
                  Open Integrations
                </Link>
              ) : null}
              {!check.ok && check.fix === "billing" ? (
                <Link href="/app/billing" className="text-xs font-medium text-accent hover:underline">
                  View plans
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueList({ items, readiness }: { items: CallRow[]; readiness: CallReadiness }) {
  const canWrite = useCanWrite();
  return (
    <ul className="grid gap-2">
      {items.map((call) => (
        <li key={call.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-xs sm:flex-row sm:items-center">
          <Link href={`/app/calls/${call.id}`} className="flex min-w-0 flex-1 items-start gap-3">
            <CompanyMark name={call.lead.name} className="size-8 text-[11px]" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[13px] font-semibold hover:underline">{call.lead.name}</span>
                <CallStatusBadge status={call.status} scheduledFor={call.scheduledFor} />
                <CallTypeLabel type={call.type} />
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-foreground-muted">
                {call.brief?.objective ?? "Brief ready"}
                {call.campaign ? <> · {call.campaign.name}</> : null}
              </span>
              <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                Prepared <RelativeTime value={call.createdAt} />
                {call.scheduledFor ? (
                  <>
                    {" "}
                    · dials <RelativeTime value={call.scheduledFor} />
                  </>
                ) : null}
              </span>
            </span>
          </Link>
          {canWrite ? (
            <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
              <CancelCallButton callId={call.id} />
              {call.status === "PREPARED" && (call.type === "MANUAL" || readiness.ready) ? (
                <StartCallButton call={{ ...call, lead: call.lead }} simulated={readiness.provider.simulated} announceAi={readiness.settings.announceAiOnCalls} />
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LiveList({ items }: { items: CallRow[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((call) => (
        <li key={call.id}>
          <Link href={`/app/calls/${call.id}`} className="group flex items-center gap-3 rounded-lg border border-good/40 bg-surface p-3.5 shadow-xs transition-colors hover:border-good">
            <span className="relative flex size-8 items-center justify-center rounded-full bg-success-soft text-success-text">
              <span className="absolute inset-0 animate-ping rounded-full bg-success-soft" />
              <Radio className="relative size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold">{call.lead.name}</span>
                <CallStatusBadge status={call.status} />
              </span>
              <span className="text-xs text-foreground-muted">{call.toNumber}</span>
            </span>
            {call.answeredAt ?? call.startedAt ? <ElapsedTimer since={(call.answeredAt ?? call.startedAt) as string} className="text-sm font-semibold" /> : null}
            <span className="hidden items-center gap-1 text-xs font-medium text-accent sm:inline-flex">
              Follow live <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HistoryTable({ items }: { items: CallRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-muted/60 text-left text-xs text-foreground-muted">
            <th className="px-4 py-2 font-medium">Lead</th>
            <th className="px-3 py-2 font-medium">Outcome</th>
            <th className="hidden px-3 py-2 font-medium lg:table-cell">Summary</th>
            <th className="px-3 py-2 text-right font-medium">Length</th>
            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((call) => (
            <tr key={call.id} className="group hover:bg-surface-muted/40">
              <td className="px-4 py-2.5">
                <Link href={`/app/calls/${call.id}`} className="flex items-center gap-2.5">
                  <CompanyMark name={call.lead.name} className="size-7 text-[10px]" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:underline">{call.lead.name}</span>
                    <CallTypeLabel type={call.type} />
                  </span>
                </Link>
              </td>
              <td className="px-3 py-2.5">{call.outcome ? <OutcomeBadge outcome={call.outcome} /> : <CallStatusBadge status={call.status} />}</td>
              <td className="hidden max-w-md px-3 py-2.5 lg:table-cell">
                <p className="truncate text-xs text-foreground-muted">{call.summary ?? "—"}</p>
              </td>
              <td className="px-3 py-2.5 text-right text-xs tabular">{call.answeredAt ? formatDuration(call.durationSeconds) : "—"}</td>
              <td className="hidden px-3 py-2.5 text-right text-xs text-foreground-muted sm:table-cell">
                <RelativeTime value={call.startedAt ?? call.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CallsView({ initialReadiness }: { initialReadiness: CallReadiness }) {
  const canManage = useCanManage();
  const canWrite = useCanWrite();
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const readiness = useQuery({ queryKey: ["call-readiness"], queryFn: () => api<CallReadiness>("/api/v1/calls/readiness"), initialData: initialReadiness });
  const stats = useQuery({ queryKey: ["call-stats"], queryFn: () => api<CallStats>("/api/v1/calls/stats?days=30"), refetchInterval: 15_000 });
  const live = stats.data?.live ?? 0;
  const [view, setView] = React.useState<View | null>(null);
  const activeView: View = view ?? (live ? "live" : (stats.data?.queue ?? 0) ? "queue" : "history");
  const list = useQuery({
    queryKey: ["calls", activeView],
    queryFn: () => apiWithMeta<CallRow[], { total: number; counts: Record<View, number> }>(`/api/v1/calls?view=${activeView}&pageSize=50`),
    refetchInterval: activeView === "history" ? 30_000 : 3_000,
    placeholderData: (previous) => previous,
  });
  const counts = list.data?.meta.counts;
  const aiAvailable = readiness.data.ready;

  return (
    <div className="grid gap-5">
      <PageHero
        title="Calls"
        highlight="Calls"
        description="AI voice agent and manual calls: a brief before, a live transcript during, and an outcome with follow-ups after."
        actions={
        <>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setSetupOpen(true)}>
              <Settings2 /> Calling setup
            </Button>
          ) : null}
          {canWrite ? (
            <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
              <Plus /> New call
            </Button>
          ) : null}
        </>
        }
      />

      <Readiness readiness={readiness.data} onSetup={canManage ? () => setSetupOpen(true) : null} />

      {stats.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[84px]" />
          ))}
        </div>
      ) : stats.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Calls placed" value={formatNumber(stats.data.placed)} hint="Last 30 days" />
          <MetricCard label="Connect rate" value={pct(stats.data.connectRate)} hint={`${formatNumber(stats.data.connected)} conversations`} />
          <MetricCard label="Positive" value={pct(stats.data.positiveRate)} hint="of conversations" />
          <MetricCard label="Avg length" value={formatDuration(stats.data.avgDurationSeconds)} hint="Connected calls" />
          <MetricCard label="Meetings booked" value={formatNumber(stats.data.meetings)} hint="From calls" />
          <MetricCard
            label="Voice minutes"
            value={formatNumber(stats.data.minutes)}
            hint={readiness.data.minutesRemaining === null ? `$${stats.data.costUsd.toFixed(2)} est. cost` : `${formatNumber(readiness.data.minutesRemaining)} left · $${stats.data.costUsd.toFixed(2)}`}
          />
        </div>
      ) : null}

      <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-3">
          <SegmentedControl
            size="sm"
            value={activeView}
            onValueChange={setView}
            options={(["queue", "live", "history"] as const).map((item) => ({
              value: item,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {item === "live" && (counts?.live ?? live) ? <span className="size-1.5 animate-pulse rounded-full bg-good" /> : null}
                  {{ queue: "To call", live: "Live", history: "History" }[item]}
                  <span className="text-foreground-subtle tabular">{counts?.[item] ?? ""}</span>
                </span>
              ),
            }))}
          />
          {list.isPending ? (
            <Skeleton className="h-64" />
          ) : list.isError ? (
            <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : !list.data.data.length ? (
            <div className="rounded-lg border border-dashed border-border bg-surface">
              <EmptyState
                icon={PhoneCall}
                title={{ queue: "No calls waiting", live: "No calls in progress", history: "No calls yet" }[activeView]}
                description={{
                  queue: "Prepared calls — from campaigns with AI call steps or created here — wait for you to start them.",
                  live: "Live calls appear here with a running timer; open one to follow the transcript.",
                  history: "Finished calls with their outcome, summary and transcript.",
                }[activeView]}
                action={
                  canWrite && activeView !== "live" ? (
                    <Button size="sm" variant="secondary" onClick={() => setNewOpen(true)}>
                      <Plus /> New call
                    </Button>
                  ) : null
                }
              />
            </div>
          ) : activeView === "queue" ? (
            <QueueList items={list.data.data} readiness={readiness.data} />
          ) : activeView === "live" ? (
            <LiveList items={list.data.data} />
          ) : (
            <HistoryTable items={list.data.data} />
          )}
        </section>

        <aside className="grid content-start gap-4">
          <ChartCard
            title="Outcomes"
            description="Connected calls, last 30 days"
            height={170}
            table={{ columns: ["Outcome", "Calls"], rows: (stats.data?.outcomes ?? []).map((item) => [CALL_OUTCOME_LABELS[item.outcome as CallOutcome] ?? item.outcome, item.count]) }}
            empty={stats.data?.outcomes.length ? undefined : <EmptyState compact title="No outcomes yet" />}
          >
            <DonutChart
              data={(stats.data?.outcomes ?? []).map((item) => ({ label: CALL_OUTCOME_LABELS[item.outcome as CallOutcome] ?? item.outcome, value: item.count }))}
              centerValue={formatNumber(stats.data?.outcomes.reduce((sum, item) => sum + item.count, 0) ?? 0)}
              centerLabel="calls"
            />
          </ChartCard>
          <ChartCard
            title="Calls per day"
            description="Placed vs connected"
            height={170}
            legend={[
              { label: "Placed", color: "var(--series-1)" },
              { label: "Connected", color: "var(--series-3)" },
            ]}
            table={{ columns: ["Day", "Placed", "Connected"], rows: (stats.data?.series ?? []).map((row) => [formatDay(row.day), row.placed, row.connected]) }}
            empty={stats.data?.placed ? undefined : <EmptyState compact title="No calls in this period" />}
          >
            <TimeSeriesChart
              data={stats.data?.series ?? []}
              xKey="day"
              xFormat={formatDay}
              series={[
                { key: "placed", label: "Placed", slot: 0 },
                { key: "connected", label: "Connected", slot: 2 },
              ]}
            />
          </ChartCard>
        </aside>
      </div>

      {/* Keys remount the dialogs on open so they start from fresh state. */}
      {canManage ? <CallingSetupDialog key={`setup-${setupOpen}`} open={setupOpen} onOpenChange={setSetupOpen} settings={readiness.data.settings} /> : null}
      {canWrite ? <NewCallDialog key={`new-${newOpen}`} open={newOpen} onOpenChange={setNewOpen} aiAvailable={aiAvailable} /> : null}
      <p className={cn("text-[11px] text-foreground-subtle", !stats.data && "hidden")}>Numbers come from call records and meetings created by calls.</p>
    </div>
  );
}
