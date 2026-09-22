"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Mail, MessageCircle, Phone, PhoneCall, Search } from "lucide-react";
import { DEAL_STAGE_LABELS, LEAD_STATUS_LABELS, QUOTE_STATUS_LABELS, type DealStage, type LeadStatus, type QuoteStatus } from "@repo/config";
import { Badge, CompanyMark, Input, Skeleton, cn, formatCurrency } from "@repo/ui";
import { apiWithMeta } from "@/lib/api-client";

// ----------------------------------------------------------------------------- Types

export interface DealCard {
  id: string;
  title: string;
  stage: DealStage;
  value: number;
  currency: string;
  probability: number;
  position: number;
  expectedCloseDate: string | null;
  stageChangedAt: string;
  sourceChannel: "EMAIL" | "WHATSAPP" | "VOICE" | "MANUAL_CALL" | null;
  lostReason: string | null;
  lead: { id: string; name: string; category: string | null; city: string | null; locality: string | null; status: string };
  owner: { id: string; name: string } | null;
  contact: { id: string; name: string | null } | null;
  nextTask: { id: string; title: string; dueAt: string | null } | null;
  quote: { id: string; number: string; status: QuoteStatus; total: number } | null;
}

export interface PipelineSummary {
  openCount: number;
  openValue: number;
  weightedValue: number;
  wonThisMonth: { count: number; value: number };
  winRate: number | null;
  averageWon: number | null;
}

export interface PipelineData {
  deals: DealCard[];
  stages: Array<{ stage: DealStage; label: string; count: number; value: number }>;
  summary: PipelineSummary;
}

export interface Member {
  id: string;
  name: string;
}

// ----------------------------------------------------------------------------- Context

export interface CrmSettings {
  members: Member[];
  currency: string;
  /** The plan includes quotes. */
  quotesEnabled: boolean;
  planName: string;
}

const CrmContext = React.createContext<CrmSettings | null>(null);

export function CrmProvider({ value, children }: { value: CrmSettings; children: React.ReactNode }) {
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmSettings {
  const value = React.useContext(CrmContext);
  if (!value) throw new Error("useCrm must be used inside CrmProvider");
  return value;
}

// ----------------------------------------------------------------------------- Display helpers

/** Stage colour (dot / column accent), from the chart series palette. */
export const STAGE_COLOR: Record<DealStage, string> = {
  NEW: "bg-foreground-subtle",
  QUALIFIED: "bg-series-1",
  CONTACTED: "bg-series-2",
  INTERESTED: "bg-series-3",
  MEETING: "bg-series-4",
  PROPOSAL: "bg-series-5",
  NEGOTIATION: "bg-series-6",
  WON: "bg-good",
  LOST: "bg-critical",
};

export function StageDot({ stage, className }: { stage: DealStage; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", STAGE_COLOR[stage], className)} />;
}

export function StageLabel({ stage }: { stage: DealStage }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
      <StageDot stage={stage} />
      {DEAL_STAGE_LABELS[stage]}
    </span>
  );
}

export function money(value: number | null | undefined, currency = "INR", options: { compact?: boolean; decimals?: number } = {}) {
  return formatCurrency(value, currency, options);
}

const QUOTE_TONES: Record<QuoteStatus, "neutral" | "accent" | "success" | "danger" | "warning"> = {
  DRAFT: "neutral",
  SENT: "accent",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
};

export function QuoteStatusBadge({ status, viewed }: { status: QuoteStatus; viewed?: boolean }) {
  return <Badge tone={QUOTE_TONES[status]}>{status === "SENT" && viewed ? "Viewed" : QUOTE_STATUS_LABELS[status]}</Badge>;
}

export const CHANNEL_ICON = { EMAIL: Mail, WHATSAPP: MessageCircle, VOICE: PhoneCall, MANUAL_CALL: Phone } as const;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "Overdue 3d", "Today", "Tomorrow", "Fri", "12 Oct". */
export function dueText(value: string | Date): { text: string; tone: "danger" | "warning" | "muted" } {
  const due = new Date(value);
  const days = Math.round((startOfDay(due).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (days < 0) return { text: days === -1 ? "Yesterday" : `Overdue ${-days}d`, tone: "danger" };
  if (days === 0) return { text: "Today", tone: "warning" };
  if (days === 1) return { text: "Tomorrow", tone: "muted" };
  if (days < 7) return { text: due.toLocaleDateString("en-IN", { weekday: "short" }), tone: "muted" };
  return { text: due.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), tone: "muted" };
}

export function DueText({ value, className }: { value: string | Date; className?: string }) {
  const due = dueText(value);
  return <span className={cn("whitespace-nowrap", due.tone === "danger" ? "text-danger-text" : due.tone === "warning" ? "text-warning-text" : "text-foreground-muted", className)}>{due.text}</span>;
}

export function daysSince(value: string | Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

// ----------------------------------------------------------------------------- Lead picker

interface LeadOption {
  id: string;
  name: string;
  status: string;
  city: string | null;
  locality: string | null;
}

/** Searchable list of leads for dialogs (new deal, new quote, new meeting). */
export function LeadPicker({ value, onChange, enabled = true, autoFocus }: { value: string | null; onChange: (lead: LeadOption) => void; enabled?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 200);
    return () => window.clearTimeout(timer);
  }, [q]);
  const leads = useQuery({
    queryKey: ["lead-picker", debounced],
    queryFn: () => apiWithMeta<LeadOption[]>(`/api/v1/leads?pageSize=8&sort=lastActivityAt&order=desc${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    enabled,
    placeholderData: (previous) => previous,
  });
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-subtle" />
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search leads" className="pl-8" aria-label="Search leads" autoFocus={autoFocus} />
      </div>
      <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border border-border p-1" role="listbox" aria-label="Leads">
        {leads.isPending ? (
          <Skeleton className="h-24" />
        ) : (leads.data?.data ?? []).length === 0 ? (
          <li className="px-2 py-6 text-center text-xs text-foreground-muted">No leads match “{debounced}”.</li>
        ) : (
          (leads.data?.data ?? []).map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === lead.id}
                onClick={() => onChange(lead)}
                className={cn("flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left", value === lead.id ? "bg-accent-soft" : "hover:bg-surface-muted")}
              >
                <CompanyMark name={lead.name} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{lead.name}</span>
                  <span className="block truncate text-[11px] text-foreground-muted">{[LEAD_STATUS_LABELS[lead.status as LeadStatus], lead.locality, lead.city].filter(Boolean).join(" · ")}</span>
                </span>
                {value === lead.id ? <CircleCheck className="size-3.5 text-accent" /> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
