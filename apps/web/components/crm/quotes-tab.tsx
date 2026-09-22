"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, Lock, Plus, Sparkles } from "lucide-react";
import { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus } from "@repo/config";
import { Button, Callout, CompanyMark, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Skeleton, cn } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime } from "../time";
import { useNewQuote } from "../quotes/use-new-quote";
import { LeadPicker, QuoteStatusBadge, money, useCrm } from "./shared";

interface QuoteRow {
  id: string;
  number: string;
  title: string | null;
  status: QuoteStatus;
  currency: string;
  total: number;
  generatedByAI: boolean;
  createdAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  validUntil: string | null;
  lead: { id: string; name: string };
  _count: { lineItems: number };
}

export function NewQuoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [lead, setLead] = React.useState<{ id: string; name: string } | null>(null);
  const newQuote = useNewQuote();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
          <DialogDescription>Pick the company. AI can draft the items and quantities from your conversation with them — prices always come from your catalog, and nothing is sent until you do.</DialogDescription>
        </DialogHeader>
        <LeadPicker value={lead?.id ?? null} onChange={(item) => setLead({ id: item.id, name: item.name })} enabled={open} autoFocus />
        <DialogFooter>
          <Button variant="secondary" disabled={!lead || newQuote.pending} loading={newQuote.blank.isPending} onClick={() => lead && newQuote.blank.mutate({ leadId: lead.id })}>
            Start blank
          </Button>
          <Button variant="primary" disabled={!lead || newQuote.pending} loading={newQuote.draft.isPending} onClick={() => lead && newQuote.draft.mutate({ leadId: lead.id })}>
            <Sparkles /> Draft with AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuotesTab() {
  const router = useRouter();
  const canWrite = useCanWrite();
  const { quotesEnabled, planName } = useCrm();
  const [status, setStatus] = React.useState<QuoteStatus | "ALL">("ALL");
  const [creating, setCreating] = React.useState(false);
  const quotes = useQuery({
    queryKey: ["quotes", status],
    queryFn: () => api<{ quotes: QuoteRow[]; counts: Partial<Record<QuoteStatus, { count: number; total: number }>> }>(`/api/v1/quotes${status === "ALL" ? "" : `?status=${status}`}`),
    placeholderData: (previous) => previous,
  });
  const counts = quotes.data?.counts ?? {};
  const all = Object.values(counts).reduce((sum, item) => sum + (item?.count ?? 0), 0);

  return (
    <div className="grid gap-4">
      {!quotesEnabled ? (
        <Callout tone="accent" icon={Lock} action={<Link href="/app/billing" className="text-xs font-medium text-accent hover:underline">View plans</Link>}>
          Quotes aren’t included in the {planName} plan. Upgrade to Pro to send priced quotes with PDF and online acceptance.
        </Callout>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Quote status">
          {(["ALL", ...QUOTE_STATUSES] as const).map((item) => {
            const count = item === "ALL" ? all : (counts[item]?.count ?? 0);
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={status === item}
                onClick={() => setStatus(item)}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors", status === item ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground-secondary hover:border-border-strong")}
              >
                {item === "ALL" ? "All" : QUOTE_STATUS_LABELS[item]}
                <span className={cn("tabular", status === item ? "text-background/70" : "text-foreground-muted")}>{count}</span>
              </button>
            );
          })}
        </div>
        {counts.SENT?.total ? <span className="text-xs text-foreground-muted">{money(counts.SENT.total, quotes.data?.quotes[0]?.currency)} awaiting an answer</span> : null}
        {canWrite && quotesEnabled ? (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New quote
          </Button>
        ) : null}
      </div>

      {quotes.isPending ? (
        <Skeleton className="h-64" />
      ) : quotes.isError ? (
        <ErrorState description={errorMessage(quotes.error)} onRetry={() => void quotes.refetch()} />
      ) : quotes.data.quotes.length === 0 ? (
        <EmptyState icon={FileText} title={status === "ALL" ? "No quotes yet" : `No ${QUOTE_STATUS_LABELS[status as QuoteStatus].toLowerCase()} quotes`} description="Draft a quote from any deal or lead. Prospects view, download and accept it online." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full table-fixed text-left text-[13px]">
            <thead className="border-b border-border bg-surface-muted/60 text-[11px] text-foreground-muted">
              <tr>
                <th className="w-[30%] px-3 py-2 font-medium">Quote</th>
                <th className="w-[24%] px-3 py-2 font-medium">Company</th>
                <th className="w-32 px-3 py-2 text-right font-medium">Total</th>
                <th className="w-24 px-3 py-2 font-medium">Status</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Sent</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Valid until</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.data.quotes.map((quote) => (
                <tr key={quote.id} className="cursor-pointer hover:bg-surface-muted/50" onClick={() => router.push(`/app/crm/quotes/${quote.id}`)}>
                  <td className="px-3 py-2.5">
                    <Link href={`/app/crm/quotes/${quote.id}`} className="block min-w-0" onClick={(event) => event.stopPropagation()}>
                      <span className="flex items-center gap-1.5 font-medium">
                        {quote.number}
                        {quote.generatedByAI ? <Sparkles className="size-3 text-accent" aria-label="Drafted with AI" /> : null}
                      </span>
                      <span className="block truncate text-[11px] text-foreground-muted">{quote.title ?? `${quote._count.lineItems} item${quote._count.lineItems === 1 ? "" : "s"}`}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <CompanyMark name={quote.lead.name} className="size-5 text-[9px]" />
                      <span className="truncate">{quote.lead.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular">{money(quote.total, quote.currency)}</td>
                  <td className="px-3 py-2.5">
                    <QuoteStatusBadge status={quote.status} viewed={Boolean(quote.viewedAt)} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-foreground-muted md:table-cell">{quote.sentAt ? <LocalTime value={quote.sentAt} style="date" /> : "—"}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-foreground-muted lg:table-cell">{quote.validUntil ? <LocalTime value={quote.validUntil} style="date" /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <NewQuoteDialog open onOpenChange={setCreating} /> : null}
    </div>
  );
}
