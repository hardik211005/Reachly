"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarPlus, FileText, Handshake, Plus, Sparkles } from "lucide-react";
import type { DealStage, QuoteStatus } from "@repo/config";
import { Button, EmptyState, ErrorState, Skeleton } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime } from "../time";
import { useNewQuote } from "../quotes/use-new-quote";
import { MeetingDialog, NewDealDialog } from "./deal-dialogs";
import { CrmProvider, QuoteStatusBadge, StageLabel, daysSince, money, useCrm, type CrmSettings } from "./shared";

interface LeadDealsData {
  deals: Array<{ id: string; title: string; stage: DealStage; value: number; currency: string; probability: number; stageChangedAt: string; lostReason: string | null; owner: { id: string; name: string } | null }>;
  quotes: Array<{ id: string; number: string; title: string | null; status: QuoteStatus; total: number; currency: string; createdAt: string; viewedAt: string | null }>;
}

function Panel({ lead }: { lead: { id: string; name: string } }) {
  const canWrite = useCanWrite();
  const { quotesEnabled } = useCrm();
  const newQuote = useNewQuote();
  const [dialog, setDialog] = React.useState<"deal" | "meeting" | null>(null);
  const data = useQuery({ queryKey: ["lead-deals", lead.id], queryFn: () => api<LeadDealsData>(`/api/v1/leads/${lead.id}/deals`) });
  const openDeal = data.data?.deals.find((deal) => deal.stage !== "WON" && deal.stage !== "LOST");

  if (data.isPending) return <Skeleton className="h-48" />;
  if (data.isError) return <ErrorState description={errorMessage(data.error)} onRetry={() => void data.refetch()} />;

  return (
    <div className="grid gap-5">
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDialog("deal")}>
            <Plus /> New deal
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog("meeting")}>
            <CalendarPlus /> Schedule meeting
          </Button>
          {quotesEnabled ? (
            <>
              <Button size="sm" variant="secondary" loading={newQuote.blank.isPending} disabled={newQuote.pending} onClick={() => newQuote.blank.mutate({ leadId: lead.id, dealId: openDeal?.id })}>
                <FileText /> New quote
              </Button>
              <Button size="sm" variant="primary" loading={newQuote.draft.isPending} disabled={newQuote.pending} onClick={() => newQuote.draft.mutate({ leadId: lead.id, dealId: openDeal?.id })}>
                <Sparkles /> Draft quote with AI
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">Deals</h3>
        {data.data.deals.length === 0 ? (
          <EmptyState compact icon={Handshake} title="No deals yet" description="A deal opens automatically when this lead gets interested, books a meeting or receives a quote." />
        ) : (
          <ul className="grid gap-2">
            {data.data.deals.map((deal) => (
              <li key={deal.id}>
                <Link href={`/app/crm?deal=${deal.id}`} className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{deal.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-muted">
                      <StageLabel stage={deal.stage} />
                      <span>{deal.stage === "LOST" && deal.lostReason ? `· ${deal.lostReason}` : `· ${daysSince(deal.stageChangedAt)}d in stage`}</span>
                      {deal.owner ? <span>· {deal.owner.name}</span> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[15px] font-semibold tabular">{deal.value ? money(deal.value, deal.currency) : "—"}</p>
                    {deal.stage !== "WON" && deal.stage !== "LOST" ? <p className="text-[11px] text-foreground-muted">{deal.probability}% likely</p> : null}
                  </div>
                  <ArrowUpRight className="size-4 text-foreground-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">Quotes</h3>
        {data.data.quotes.length === 0 ? (
          <p className="text-xs text-foreground-muted">{quotesEnabled ? "No quotes yet. AI can draft one from your conversation — prices always come from your catalog." : "Quotes are available on the Pro and Scale plans."}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data.data.quotes.map((quote) => (
              <li key={quote.id}>
                <Link href={`/app/crm/quotes/${quote.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted/50">
                  <FileText className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {quote.number}
                      {quote.title ? <span className="font-normal text-foreground-muted"> · {quote.title}</span> : null}
                    </span>
                    <span className="block text-[11px] text-foreground-muted">
                      Created <LocalTime value={quote.createdAt} style="date" />
                    </span>
                  </span>
                  <span className="text-[13px] font-medium tabular">{money(quote.total, quote.currency)}</span>
                  <QuoteStatusBadge status={quote.status} viewed={Boolean(quote.viewedAt)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === "deal" ? <NewDealDialog open onOpenChange={(open) => (open ? null : setDialog(null))} lead={lead} stage={openDeal ? "NEW" : "QUALIFIED"} /> : null}
      {dialog === "meeting" ? <MeetingDialog open onOpenChange={(open) => (open ? null : setDialog(null))} lead={lead} dealId={openDeal?.id ?? null} /> : null}
    </div>
  );
}

export function LeadDeals({ lead, settings }: { lead: { id: string; name: string }; settings: CrmSettings }) {
  return (
    <CrmProvider value={settings}>
      <Panel lead={lead} />
    </CrmProvider>
  );
}
