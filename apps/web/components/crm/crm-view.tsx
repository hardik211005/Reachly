"use client";

import * as React from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AnimatedNumber, Button, ErrorState, SearchInput, SegmentedControl, SpotlightCard, cn, formatPercent } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { PageHero } from "../page-hero";
import { CatalogTab } from "./catalog-tab";
import { ContactsTab, MeetingsTab, TasksTab } from "./crm-tabs";
import { NewDealDialog } from "./deal-dialogs";
import { DealSheet } from "./deal-sheet";
import { PipelineBoard, PipelineSkeletonColumns } from "./pipeline-board";
import { QuotesTab } from "./quotes-tab";
import { CrmProvider, money, type CrmSettings, type PipelineData, type PipelineSummary } from "./shared";

export type CrmTab = "pipeline" | "tasks" | "meetings" | "quotes" | "contacts" | "catalog";
const TABS: Array<{ value: CrmTab; label: string }> = [
  { value: "pipeline", label: "Pipeline" },
  { value: "tasks", label: "Tasks" },
  { value: "meetings", label: "Meetings" },
  { value: "quotes", label: "Quotes" },
  { value: "contacts", label: "Contacts" },
  { value: "catalog", label: "Products & pricing" },
];

/** Keeps tab and open deal in the URL without a server round trip. */
function useUrlState(initialTab: CrmTab, initialDeal: string | null) {
  const [tab, setTabState] = React.useState<CrmTab>(initialTab);
  const [dealId, setDealState] = React.useState<string | null>(initialDeal);
  const write = (next: { tab?: CrmTab; deal?: string | null }) => {
    const params = new URLSearchParams(window.location.search);
    if (next.tab !== undefined) {
      if (next.tab === "pipeline") params.delete("tab");
      else params.set("tab", next.tab);
    }
    if (next.deal !== undefined) {
      if (next.deal) params.set("deal", next.deal);
      else params.delete("deal");
    }
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };
  return {
    tab,
    dealId,
    setTab: (next: CrmTab) => {
      setTabState(next);
      write({ tab: next });
    },
    openDeal: (id: string | null) => {
      setDealState(id);
      write({ deal: id });
    },
  };
}

function Stat({ label, value, format, hint, tone }: { label: string; value: number | null | undefined; format: (value: number) => string; hint?: React.ReactNode; tone?: "good" }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-xs text-foreground-muted">{label}</p>
      <p className={cn("mt-1 truncate text-lg leading-tight font-semibold tabular tracking-[-0.01em]", tone === "good" && "text-success-text")}>{value === null || value === undefined ? "—" : <AnimatedNumber value={value} format={format} />}</p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-foreground-muted">{hint}</p> : null}
    </div>
  );
}

function SummaryStrip({ summary, currency }: { summary: PipelineSummary | undefined; currency: string }) {
  return (
    <SpotlightCard className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs sm:grid-cols-3 lg:grid-cols-5 lg:divide-x *:min-w-0">
      <Stat label="Open pipeline" value={summary?.openValue} format={(value) => money(value, currency, { compact: value >= 10_000_000 })} hint={summary ? `${summary.openCount} open deal${summary.openCount === 1 ? "" : "s"}` : undefined} />
      <Stat label="Weighted forecast" value={summary?.weightedValue} format={(value) => money(value, currency, { compact: value >= 10_000_000 })} hint="Value × stage probability" />
      <Stat label="Won this month" tone="good" value={summary?.wonThisMonth.value} format={(value) => money(value, currency, { compact: value >= 10_000_000 })} hint={summary ? `${summary.wonThisMonth.count} deal${summary.wonThisMonth.count === 1 ? "" : "s"}` : undefined} />
      <Stat label="Win rate" value={summary?.winRate} format={(value) => formatPercent(value, 0)} hint="Closed in the last 90 days" />
      <Stat label="Average won deal" value={summary?.averageWon} format={(value) => money(value, currency, { compact: value >= 10_000_000 })} hint="Last 90 days" />
    </SpotlightCard>
  );
}

function PipelineTab({ pipeline, queryKey, owner, setOwner, q, setQ, onOpen }: {
  pipeline: UseQueryResult<PipelineData>;
  queryKey: readonly unknown[];
  owner: "all" | "me";
  setOwner: (owner: "all" | "me") => void;
  q: string;
  setQ: (q: string) => void;
  onOpen: (id: string) => void;
}) {
  const filtered = Boolean(q) || owner === "me";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search deals or companies" className="w-full sm:w-64" />
        <SegmentedControl size="sm" value={owner} onValueChange={setOwner} options={[{ value: "all", label: "All deals" }, { value: "me", label: "My deals" }]} />
        {pipeline.data ? (
          <span className="text-xs text-foreground-muted sm:ml-auto">
            {filtered ? `${pipeline.data.deals.length} matching · ` : ""}Drag cards between stages · won and lost show the last 30 days
          </span>
        ) : null}
      </div>
      {pipeline.isPending ? (
        <PipelineSkeletonColumns />
      ) : pipeline.isError ? (
        <ErrorState description={errorMessage(pipeline.error)} onRetry={() => void pipeline.refetch()} />
      ) : (
        <PipelineBoard data={pipeline.data} queryKey={queryKey} onOpen={onOpen} />
      )}
    </div>
  );
}

export function CrmView({ settings, initialTab, initialDeal }: { settings: CrmSettings; initialTab: CrmTab; initialDeal: string | null }) {
  const canWrite = useCanWrite();
  const { tab, dealId, setTab, openDeal } = useUrlState(initialTab, initialDeal);
  const [creating, setCreating] = React.useState(false);
  const [owner, setOwner] = React.useState<"all" | "me">("all");
  const [q, setQ] = React.useState("");
  // The board and the summary strip share one query; filters only narrow the board.
  const queryKey = ["pipeline", owner, q] as const;
  const pipeline = useQuery({
    queryKey,
    queryFn: () => api<PipelineData>(`/api/v1/deals?owner=${owner}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  });

  return (
    <CrmProvider value={settings}>
      <div className="grid gap-5">
        <PageHero
          title="CRM"
          highlight="CRM"
          description="Deals, next steps, meetings and quotes for the companies your outreach warms up — kept in step with replies, calls and quote answers automatically."
          actions={
            canWrite ? (
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <Plus /> New deal
              </Button>
            ) : null
          }
        />
        <SummaryStrip summary={pipeline.data?.summary} currency={settings.currency} />
        <SegmentedControl size="sm" value={tab} onValueChange={setTab} options={TABS} className="max-w-full overflow-x-auto" />
        <div className="min-w-0">
          {tab === "pipeline" ? <PipelineTab pipeline={pipeline} queryKey={queryKey} owner={owner} setOwner={setOwner} q={q} setQ={setQ} onOpen={openDeal} /> : null}
          {tab === "tasks" ? <TasksTab onOpenDeal={openDeal} /> : null}
          {tab === "meetings" ? <MeetingsTab onOpenDeal={openDeal} /> : null}
          {tab === "quotes" ? <QuotesTab /> : null}
          {tab === "contacts" ? <ContactsTab /> : null}
          {tab === "catalog" ? <CatalogTab /> : null}
        </div>
      </div>
      <DealSheet dealId={dealId} onClose={() => openDeal(null)} />
      {creating ? <NewDealDialog open onOpenChange={setCreating} onCreated={openDeal} /> : null}
    </CrmProvider>
  );
}
