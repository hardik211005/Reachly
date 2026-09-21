"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, CalendarCheck, CircleAlert, FlaskConical, ListChecks, MessageSquareQuote, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { CallOutcome } from "@repo/config";
import { Callout, CompanyMark, ScoreIndicator, cn } from "@repo/ui";
import { api } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime, RelativeTime } from "../time";
import { CancelCallButton, HangUpButton, LogOutcomeForm, StartCallButton } from "./call-actions";
import { CallStatusBadge, CallTypeLabel, ElapsedTimer, OutcomeBadge, formatDuration, type CallStatus } from "./shared";

interface Segment {
  speaker: "agent" | "prospect";
  text: string;
  startMs: number;
  endMs: number;
}

interface Brief {
  objective: string;
  summary: string;
  opening: string;
  pitch: string;
  talkingPoints: string[];
  questions: string[];
  objections: Array<{ objection: string; response: string }>;
  closing: string;
  voicemail: string;
  guardrails: string[];
}

export interface CallDetailData {
  id: string;
  type: "AI_AGENT" | "MANUAL";
  status: CallStatus;
  outcome: CallOutcome | null;
  summary: string | null;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  nextAction: string | null;
  followUpAt: string | null;
  toNumber: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  error: string | null;
  provider: string | null;
  brief: Brief | null;
  scheduledFor: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  createdAt: string;
  metadata: {
    simulated?: boolean;
    outsideHoursSimulated?: boolean;
    endedReason?: string | null;
    analysis?: { interestLevel: number; keyPoints: string[]; objections: string[]; source: "ai" | "rules" | "manual" };
  } | null;
  lead: { id: string; name: string; city: string | null; locality: string | null; score: number | null; category: string | null; status: string; phone: string | null; doNotContact: boolean };
  contact: { id: string; name: string | null; title: string | null } | null;
  campaign: { id: string; name: string } | null;
  transcript: { segments: Segment[] } | null;
  meeting: { id: string; title: string; scheduledAt: string; status: string } | null;
}

const LIVE: CallStatus[] = ["QUEUED", "RINGING", "IN_PROGRESS"];

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------- Transcript

function Transcript({ call }: { call: CallDetailData }) {
  const segments = call.transcript?.segments ?? [];
  const live = call.status === "IN_PROGRESS";
  const end = React.useRef<HTMLDivElement>(null);
  const count = segments.length;
  React.useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, live]);

  let empty: string | null = null;
  if (!segments.length) {
    empty =
      call.status === "PREPARED" || call.status === "QUEUED"
        ? "The transcript appears here, line by line, once the call connects."
        : call.status === "RINGING"
          ? "Ringing…"
          : call.status === "NO_ANSWER" || call.status === "BUSY"
            ? "Nobody picked up, so there's no conversation to show."
            : call.type === "MANUAL"
              ? "Manual calls aren't transcribed — see the notes in the outcome."
              : "No transcript was recorded for this call.";
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <MessageSquareQuote className="size-4 text-foreground-muted" /> Transcript
        </h2>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-text">
            <span className="size-1.5 animate-pulse rounded-full bg-good" /> Live
          </span>
        ) : segments.length ? (
          <span className="text-xs text-foreground-muted">{segments.length} lines</span>
        ) : null}
      </header>
      {empty ? (
        <p className="px-4 py-10 text-center text-[13px] text-foreground-muted">{empty}</p>
      ) : (
        <ol className="grid max-h-[560px] gap-3 overflow-y-auto px-4 py-4">
          {segments.map((segment, index) => {
            const agent = segment.speaker === "agent";
            return (
              <li key={index} className={cn("flex gap-2.5", agent ? "" : "flex-row-reverse text-right")}>
                <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", agent ? "bg-accent-soft text-accent-soft-foreground" : "bg-surface-sunken text-foreground-secondary")}>
                  {agent ? <Bot className="size-3.5" /> : <UserRound className="size-3.5" />}
                </span>
                <div className={cn("flex max-w-[82%] flex-col gap-0.5", agent ? "items-start" : "items-end")}>
                  <span className="text-[11px] text-foreground-muted">
                    {agent ? (call.type === "AI_AGENT" ? "AI agent" : "You") : (call.contact?.name ?? call.lead.name)} · <span className="tabular">{clock(segment.startMs)}</span>
                  </span>
                  <p className={cn("rounded-xl px-3 py-2 text-left text-[13px] leading-relaxed", agent ? "rounded-tl-sm bg-surface-muted text-foreground-secondary" : "rounded-tr-sm border border-border bg-surface-raised text-foreground")}>
                    {segment.text}
                  </p>
                </div>
              </li>
            );
          })}
          {live ? (
            <li className="flex items-center gap-1 pl-9 text-foreground-subtle" aria-label="Call in progress">
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-current" />
            </li>
          ) : null}
          <div ref={end} />
        </ol>
      )}
      {call.recordingUrl ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 text-xs text-foreground-muted">Recording (stored with {call.provider ?? "your provider"})</p>
          <audio controls preload="none" src={call.recordingUrl} className="h-9 w-full" />
        </div>
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------------------- Analysis

function Analysis({ call }: { call: CallDetailData }) {
  if (!call.outcome) {
    if (call.status === "COMPLETED")
      return (
        <section className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-foreground-muted shadow-xs">
          <Sparkles className="size-4 animate-pulse text-accent" /> Analysing the conversation…
        </section>
      );
    return null;
  }
  const analysis = call.metadata?.analysis;
  const interest = analysis?.interestLevel ?? null;
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles className="size-4 text-accent" /> {analysis?.source === "manual" ? "Outcome" : "What happened"}
        </h2>
        <OutcomeBadge outcome={call.outcome} />
        {call.sentiment ? <span className="text-xs text-foreground-muted">{call.sentiment.toLowerCase()} sentiment</span> : null}
        <span className="ml-auto text-[11px] text-foreground-subtle">{analysis?.source === "manual" ? "Logged by a person" : analysis?.source === "rules" ? "Rule-based analysis" : "AI analysis"}</span>
      </header>
      <div className="grid gap-4 px-4 py-4">
        {call.summary ? <p className="text-[13px] leading-relaxed text-foreground-secondary">{call.summary}</p> : null}
        {interest !== null ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-foreground-muted">Interest</span>
              <span className="font-medium tabular">{interest}/100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full" style={{ width: `${interest}%`, background: interest >= 65 ? "var(--status-good)" : interest >= 40 ? "var(--status-warning)" : "var(--series-muted)" }} />
            </div>
          </div>
        ) : null}
        {analysis?.keyPoints.length || analysis?.objections.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {analysis.keyPoints.length ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">They said</p>
                <ul className="grid gap-1.5 text-[13px] text-foreground-secondary">
                  {analysis.keyPoints.map((point) => (
                    <li key={point} className="leading-relaxed">“{point}”</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {analysis.objections.length ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">Concerns raised</p>
                <ul className="grid gap-1.5 text-[13px] text-foreground-secondary">
                  {analysis.objections.map((objection) => (
                    <li key={objection} className="leading-relaxed">{objection}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2 rounded-md bg-surface-muted/70 px-3 py-2.5 text-[13px] sm:grid-cols-2">
          {call.nextAction ? (
            <p>
              <span className="block text-xs text-foreground-muted">Next step</span>
              {call.nextAction}
            </p>
          ) : null}
          {call.meeting ? (
            <p>
              <span className="block text-xs text-foreground-muted">Meeting booked</span>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <CalendarCheck className="size-3.5 text-success-text" /> <LocalTime value={call.meeting.scheduledAt} />
              </span>
            </p>
          ) : call.followUpAt ? (
            <p>
              <span className="block text-xs text-foreground-muted">Follow up</span>
              <LocalTime value={call.followUpAt} style="date" />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Brief

function BriefCard({ brief }: { brief: Brief | null }) {
  if (!brief) return null;
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <ListChecks className="size-4 text-foreground-muted" /> Call brief
        </h2>
        <p className="mt-0.5 text-xs text-foreground-muted">{brief.objective}</p>
      </header>
      <div className="grid gap-4 px-4 py-4 text-[13px]">
        <p className="leading-relaxed text-foreground-secondary">{brief.summary}</p>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground-muted">Opening</p>
          <p className="rounded-md bg-accent-soft px-3 py-2 leading-relaxed text-accent-soft-foreground">“{brief.opening}”</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground-muted">Pitch</p>
          <p className="leading-relaxed text-foreground-secondary">{brief.pitch}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground-muted">Questions to ask</p>
          <ol className="grid list-decimal gap-1 pl-4 text-foreground-secondary">
            {brief.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground-muted">If they say…</p>
          <dl className="grid gap-2">
            {brief.objections.map((item) => (
              <div key={item.objection} className="rounded-md border border-border px-3 py-2">
                <dt className="font-medium">“{item.objection}”</dt>
                <dd className="mt-0.5 leading-relaxed text-foreground-secondary">{item.response}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground-muted">Close</p>
          <p className="leading-relaxed text-foreground-secondary">{brief.closing}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-foreground-muted">Voicemail</p>
          <p className="leading-relaxed text-foreground-secondary">{brief.voicemail}</p>
        </div>
        <div className="rounded-md bg-surface-muted/70 px-3 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
            <ShieldCheck className="size-3.5 text-success-text" /> Guardrails
          </p>
          <ul className="grid gap-1 text-xs leading-relaxed text-foreground-secondary">
            {brief.guardrails.map((rule) => (
              <li key={rule}>• {rule}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Page

export function CallDetail({ initial, simulatedProvider, announceAi, aiReady }: { initial: CallDetailData; simulatedProvider: boolean; announceAi: boolean; aiReady: boolean }) {
  const canWrite = useCanWrite();
  const query = useQuery({
    queryKey: ["call", initial.id],
    queryFn: () => api<CallDetailData>(`/api/v1/calls/${initial.id}`),
    initialData: initial,
    refetchInterval: (state) => {
      const data = state.state.data;
      if (!data) return false;
      if (LIVE.includes(data.status)) return 1_500;
      if (data.status === "COMPLETED" && !data.outcome) return 2_000;
      return false;
    },
  });
  const call = query.data;
  const place = [call.lead.locality, call.lead.city].filter(Boolean).join(", ");
  const live = call.status === "RINGING" || call.status === "IN_PROGRESS";

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/app/calls" className="mb-3 inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
          <ArrowLeft className="size-3" /> Calls
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyMark name={call.lead.name} className="size-11 text-sm" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/app/leads/${call.lead.id}`} className="truncate text-xl font-semibold tracking-[-0.01em] hover:underline">
                  {call.lead.name}
                </Link>
                <ScoreIndicator score={call.lead.score} size="sm" />
                <CallStatusBadge status={call.status} scheduledFor={call.scheduledFor} />
                {call.outcome ? <OutcomeBadge outcome={call.outcome} /> : null}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-foreground-muted">
                <CallTypeLabel type={call.type} />
                <span className="tabular">{call.toNumber}</span>
                {call.contact?.name ? <span>{[call.contact.name, call.contact.title].filter(Boolean).join(", ")}</span> : null}
                {place ? <span>{place}</span> : null}
                {call.campaign ? (
                  <Link href={`/app/campaigns/${call.campaign.id}`} className="hover:text-foreground hover:underline">
                    {call.campaign.name}
                  </Link>
                ) : null}
                {live && (call.answeredAt ?? call.startedAt) ? (
                  <span className="inline-flex items-center gap-1 font-medium text-success-text">
                    <ElapsedTimer since={(call.answeredAt ?? call.startedAt) as string} />
                  </span>
                ) : call.endedAt && call.answeredAt ? (
                  <span>
                    {formatDuration(call.durationSeconds)} · <RelativeTime value={call.endedAt} />
                  </span>
                ) : (
                  <span>
                    Prepared <RelativeTime value={call.createdAt} />
                  </span>
                )}
              </p>
            </div>
          </div>
          {canWrite ? (
            <div className="flex shrink-0 items-center gap-2">
              {call.status === "PREPARED" || call.status === "QUEUED" ? <CancelCallButton callId={call.id} /> : null}
              {call.status === "PREPARED" && (call.type === "MANUAL" || aiReady) ? <StartCallButton call={call} simulated={simulatedProvider} announceAi={announceAi} size="md" /> : null}
              {live && call.type === "AI_AGENT" ? <HangUpButton callId={call.id} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      {call.metadata?.simulated ? (
        <Callout tone="warning" icon={FlaskConical}>
          Simulated call (demo voice provider) — nobody was dialled. The conversation follows the same call policy a real call uses, and is labelled everywhere.
          {call.metadata.outsideHoursSimulated ? " It ran outside calling hours; a real call would have waited for the next calling window." : ""}
        </Callout>
      ) : null}
      {call.status === "PREPARED" && call.type === "AI_AGENT" && !aiReady ? (
        <Callout tone="warning" icon={CircleAlert} action={<Link href="/app/calls" className="text-xs font-medium text-accent hover:underline">See setup</Link>}>
          AI calling isn’t set up yet. You can still use this brief to call manually.
        </Callout>
      ) : null}
      {call.error ? (
        <Callout tone="danger" icon={CircleAlert} title="This call didn’t go through">
          {call.error}
        </Callout>
      ) : null}

      <div className="grid gap-5 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-4">
          {call.type === "MANUAL" && call.status === "IN_PROGRESS" && canWrite ? <LogOutcomeForm callId={call.id} /> : null}
          <Analysis call={call} />
          <Transcript call={call} />
        </div>
        <aside className="grid content-start gap-4">
          <BriefCard brief={call.brief} />
        </aside>
      </div>
    </div>
  );
}
