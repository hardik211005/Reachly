"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Check, Phone, PhoneCall, Search, UserRound } from "lucide-react";
import { CALL_OUTCOME_LABELS, type CallOutcome } from "@repo/config";
import {
  Badge,
  Button,
  CompanyMark,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  RadioCard,
  RadioGroup,
  ScoreIndicator,
  Skeleton,
  cn,
  toast,
  type StatusTone,
} from "@repo/ui";
import { api, apiWithMeta, errorMessage } from "@/lib/api-client";

export type CallStatus = "PREPARED" | "QUEUED" | "RINGING" | "IN_PROGRESS" | "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELED";

const STATUS: Record<CallStatus, { label: string; tone: StatusTone }> = {
  PREPARED: { label: "Ready to call", tone: "accent" },
  QUEUED: { label: "Dialling soon", tone: "accent" },
  RINGING: { label: "Ringing", tone: "warning" },
  IN_PROGRESS: { label: "Live", tone: "success" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  NO_ANSWER: { label: "No answer", tone: "muted" },
  BUSY: { label: "Busy", tone: "muted" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELED: { label: "Canceled", tone: "muted" },
};

export const LIVE_STATUSES: CallStatus[] = ["QUEUED", "RINGING", "IN_PROGRESS"];

export function CallStatusBadge({ status, scheduledFor }: { status: CallStatus; scheduledFor?: string | null }) {
  const meta = STATUS[status];
  const live = status === "RINGING" || status === "IN_PROGRESS";
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground-secondary", live && "border-transparent bg-success-soft text-success-text")}>
      <span className="relative flex size-1.5">
        {live ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-75" /> : null}
        <StatusBadgeDot tone={meta.tone} />
      </span>
      {status === "QUEUED" && scheduledFor ? "Scheduled" : meta.label}
    </span>
  );
}

function StatusBadgeDot({ tone }: { tone: StatusTone }) {
  const colors: Record<StatusTone, string> = { neutral: "bg-foreground-muted", accent: "bg-accent", success: "bg-good", warning: "bg-warning", danger: "bg-critical", muted: "bg-foreground-subtle" };
  return <span className={cn("relative inline-flex size-1.5 rounded-full", colors[tone])} />;
}

const OUTCOME_TONES: Record<CallOutcome, "success" | "accent" | "warning" | "danger" | "neutral"> = {
  MEETING_REQUESTED: "success",
  INTERESTED: "success",
  NEEDS_INFORMATION: "accent",
  CALL_BACK_LATER: "warning",
  NOT_INTERESTED: "neutral",
  WRONG_CONTACT: "neutral",
  DO_NOT_CONTACT: "danger",
  UNKNOWN: "neutral",
};

export function OutcomeBadge({ outcome }: { outcome: CallOutcome | null }) {
  if (!outcome) return <span className="text-xs text-foreground-subtle">—</span>;
  return <Badge tone={OUTCOME_TONES[outcome]}>{CALL_OUTCOME_LABELS[outcome]}</Badge>;
}

export function CallTypeLabel({ type }: { type: "AI_AGENT" | "MANUAL" }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
      {type === "AI_AGENT" ? <Bot className="size-3" /> : <UserRound className="size-3" />}
      {type === "AI_AGENT" ? "AI agent" : "Manual"}
    </span>
  );
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/** Ticking elapsed time for live calls. */
export function ElapsedTimer({ since, className }: { since: string; className?: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className={cn("tabular", className)} suppressHydrationWarning>
      {formatDuration(Math.max(0, Math.round((now - start) / 1000)))}
    </span>
  );
}

// ----------------------------------------------------------------------------- New call

interface LeadOption {
  id: string;
  name: string;
  city: string | null;
  locality: string | null;
  score: number | null;
  phone: string | null;
  doNotContact: boolean;
}

function LeadPicker({ value, onChange }: { value: LeadOption | null; onChange: (lead: LeadOption) => void }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 200);
    return () => window.clearTimeout(timer);
  }, [q]);
  const leads = useQuery({
    queryKey: ["call-lead-picker", debounced],
    queryFn: () => apiWithMeta<LeadOption[]>(`/api/v1/leads?hasPhone=true&pageSize=8&sort=score&order=desc${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-subtle" />
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search leads with a phone number" className="pl-8" aria-label="Search leads" autoFocus />
      </div>
      <ul className="grid max-h-60 gap-0.5 overflow-y-auto rounded-md border border-border p-1" role="listbox" aria-label="Leads">
        {leads.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          (leads.data?.data ?? []).map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === lead.id}
                onClick={() => onChange(lead)}
                className={cn("flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors", value?.id === lead.id ? "bg-accent-soft" : "hover:bg-surface-muted")}
              >
                <CompanyMark name={lead.name} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{lead.name}</span>
                  <span className="block truncate text-[11px] text-foreground-muted">{[lead.locality, lead.city, lead.phone].filter(Boolean).join(" · ")}</span>
                </span>
                <ScoreIndicator score={lead.score} size="sm" />
                {value?.id === lead.id ? <Check className="size-3.5 text-accent" /> : null}
              </button>
            </li>
          ))
        )}
        {!leads.isPending && !leads.data?.data.length ? <li className="px-2 py-3 text-center text-xs text-foreground-muted">No leads with a phone number match.</li> : null}
      </ul>
    </div>
  );
}

/** Prepares a call (AI brief) for a lead, then opens the call page. */
export function NewCallDialog({ open, onOpenChange, lead: fixedLead, aiAvailable }: { open: boolean; onOpenChange: (open: boolean) => void; lead?: LeadOption | null; aiAvailable: boolean }) {
  const router = useRouter();
  const [lead, setLead] = React.useState<LeadOption | null>(fixedLead ?? null);
  const [type, setType] = React.useState<"AI_AGENT" | "MANUAL">(aiAvailable ? "AI_AGENT" : "MANUAL");
  const prepare = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/calls", { method: "POST", json: { leadId: lead?.id, type } }),
    onSuccess: (call) => {
      onOpenChange(false);
      router.push(`/app/calls/${call.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prepare a call</DialogTitle>
          <DialogDescription>We’ll write a call brief from everything we know about the lead. Nothing is dialled until you start the call.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {fixedLead ? (
            <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
              <CompanyMark name={fixedLead.name} className="size-7 text-[10px]" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{fixedLead.name}</p>
                <p className="text-xs text-foreground-muted">{fixedLead.phone ?? "No phone number"}</p>
              </div>
            </div>
          ) : (
            <LeadPicker value={lead} onChange={setLead} />
          )}
          <RadioGroup value={type} onValueChange={(value) => setType(value as "AI_AGENT" | "MANUAL")} className="grid gap-2 sm:grid-cols-2">
            <RadioCard value="AI_AGENT" disabled={!aiAvailable}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <PhoneCall className="size-3.5" /> AI voice agent
              </span>
              <span className="text-xs text-foreground-muted">{aiAvailable ? "The agent calls, follows the brief and books a meeting." : "Not available — see calling setup."}</span>
            </RadioCard>
            <RadioCard value="MANUAL">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Phone className="size-3.5" /> I’ll call myself
              </span>
              <span className="text-xs text-foreground-muted">Get the brief and script, dial from your phone, log the outcome.</span>
            </RadioCard>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!lead || !lead.phone || lead.doNotContact || prepare.isPending} onClick={() => prepare.mutate()}>
            {prepare.isPending ? "Writing the brief…" : "Prepare call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
