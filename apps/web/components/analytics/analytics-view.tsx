"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Download, Sparkles, X } from "lucide-react";
import { CHANNEL_LABELS, CHANNELS } from "@repo/config";
import type { AnalyticsReport } from "@repo/core/analytics/report";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Reveal,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { PageHero } from "../page-hero";
import {
  BreakdownExplorer,
  CampaignsCard,
  ChannelsCard,
  CohortsCard,
  CostsCard,
  FollowUpsCard,
  FunnelCard,
  HeatmapCard,
  LockedAnalytics,
  LossesCard,
  MetricGroups,
  QualityCard,
  TrendCard,
} from "./analytics-sections";

export interface FilterOptions {
  campaigns: Array<{ id: string; name: string }>;
  cities: string[];
  categories: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
}

const FILTER_KEYS = ["days", "from", "to", "campaignId", "channel", "city", "category", "source", "minScore"] as const;
const RANGES = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "12m" },
];
const ANY = "__any";

function FilterSelect({ label, value, onChange, options, width = "w-40" }: { label: string; value: string | null; onChange: (value: string | null) => void; options: Array<{ value: string; label: string }>; width?: string }) {
  return (
    <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? null : next)}>
      <SelectTrigger className={`h-8 ${width} text-xs`} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{`All ${label.toLowerCase()}`}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AnalyticsView({ options, planName, insightsEnabled }: { options: FilterOptions; planName: string; insightsEnabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = React.useMemo(() => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }, [params]);
  const get = (key: (typeof FILTER_KEYS)[number]) => params.get(key);
  const set = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const report = useQuery({ queryKey: ["analytics-report", query], queryFn: () => api<AnalyticsReport>(`/api/v1/analytics/report${query ? `?${query}` : ""}`), placeholderData: (previous) => previous });
  const custom = Boolean(get("from") || get("to"));
  const [customFrom, setCustomFrom] = React.useState(get("from")?.slice(0, 10) ?? "");
  const [customTo, setCustomTo] = React.useState(get("to")?.slice(0, 10) ?? "");
  const active = FILTER_KEYS.filter((key) => key !== "days" && key !== "from" && key !== "to" && get(key)).length;

  return (
    <div className="grid gap-5">
      <PageHero
        title="Analytics"
        highlight="Analytics"
        description="From first lead to revenue — every number is computed from recorded events, and every rate shows the counts behind it."
        actions={
        <>
          {insightsEnabled ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/app/ai-insights">
                <Sparkles /> AI insights
              </Link>
            </Button>
          ) : null}
          {report.data?.advanced ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>CSV for the current filters</DropdownMenuLabel>
                {[
                  ["metrics", "All metrics"],
                  ["series", "Activity over time"],
                  ["funnel", "Funnel"],
                ].map(([dataset, label]) => (
                  <DropdownMenuItem key={dataset} asChild>
                    <a href={`/api/v1/analytics/export?dataset=${dataset}${query ? `&${query}` : ""}`}>{label}</a>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {[
                  ["breakdown-channel", "By channel"],
                  ["breakdown-campaign", "By campaign"],
                  ["breakdown-area", "By area"],
                  ["breakdown-category", "By business type"],
                  ["breakdown-source", "By source"],
                  ["breakdown-score", "By score band"],
                ].map(([dataset, label]) => (
                  <DropdownMenuItem key={dataset} asChild>
                    <a href={`/api/v1/analytics/export?dataset=${dataset}${query ? `&${query}` : ""}`}>{label}</a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
        }
      />

      {/* Filters: one row above the charts, synced to the URL so views are shareable. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-xs">
        <SegmentedControl size="sm" value={custom ? "custom" : (get("days") ?? "30")} onValueChange={(value) => value !== "custom" && set({ days: value, from: null, to: null })} options={[...RANGES, ...(custom ? [{ value: "custom", label: "Custom" }] : [])]} />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="Custom date range">
              <CalendarRange /> {custom ? `${get("from")?.slice(0, 10) ?? "…"} → ${get("to")?.slice(0, 10) ?? "today"}` : "Dates"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="range-from" className="text-xs">
                    From
                  </Label>
                  <Input id="range-from" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-8" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="range-to" className="text-xs">
                    To
                  </Label>
                  <Input id="range-to" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-8" />
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={!customFrom}
                onClick={() => set({ from: new Date(`${customFrom}T00:00:00`).toISOString(), to: customTo ? new Date(`${customTo}T23:59:59`).toISOString() : null, days: null })}
              >
                Apply range
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <FilterSelect label="Campaigns" value={get("campaignId")} onChange={(value) => set({ campaignId: value })} options={options.campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))} width="w-48" />
        <FilterSelect label="Channels" value={get("channel")} onChange={(value) => set({ channel: value })} options={CHANNELS.map((channel) => ({ value: channel, label: CHANNEL_LABELS[channel] }))} width="w-36" />
        <FilterSelect label="Cities" value={get("city")} onChange={(value) => set({ city: value })} options={options.cities.map((city) => ({ value: city, label: city }))} width="w-36" />
        <FilterSelect label="Business types" value={get("category")} onChange={(value) => set({ category: value })} options={options.categories} width="w-40" />
        <FilterSelect label="Sources" value={get("source")} onChange={(value) => set({ source: value })} options={options.sources} width="w-36" />
        <FilterSelect
          label="Scores"
          value={get("minScore")}
          onChange={(value) => set({ minScore: value })}
          options={[
            { value: "40", label: "Score 40+" },
            { value: "60", label: "Score 60+" },
            { value: "80", label: "Score 80+" },
          ]}
          width="w-32"
        />
        {active ? (
          <Button size="sm" variant="ghost" onClick={() => set({ campaignId: null, channel: null, city: null, category: null, source: null, minScore: null })}>
            <X /> Clear {active} filter{active === 1 ? "" : "s"}
          </Button>
        ) : null}
        {report.isFetching && !report.isPending ? <span className="ml-auto text-[11px] text-foreground-muted">Updating…</span> : null}
      </div>

      {report.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      ) : report.isError ? (
        <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />
      ) : (
        <>
          <MetricGroups report={report.data} />
          <Reveal className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] *:min-w-0">
            <TrendCard report={report.data} />
            <FunnelCard report={report.data} />
          </Reveal>
          <Reveal className="grid gap-4 lg:grid-cols-2 *:min-w-0">
            <ChannelsCard rows={report.data.channels} currency={report.data.currency} />
            {report.data.detail ? <BreakdownExplorer query={query} currency={report.data.currency} /> : <LockedAnalytics planName={planName} />}
          </Reveal>
          {report.data.detail ? (
            <>
              <Reveal>
                <CampaignsCard rows={report.data.detail.campaigns} currency={report.data.currency} />
              </Reveal>
              <Reveal className="grid gap-4 lg:grid-cols-2 *:min-w-0">
                <HeatmapCard heatmap={report.data.detail.heatmap} />
                <FollowUpsCard steps={report.data.detail.followUps} />
              </Reveal>
              <Reveal>
                <CohortsCard initial={report.data.detail.cohorts} query={query} />
              </Reveal>
              <Reveal className="grid gap-4 lg:grid-cols-2 *:min-w-0">
                <LossesCard losses={report.data.detail.losses} currency={report.data.currency} />
                <QualityCard quality={report.data.detail.quality} />
              </Reveal>
              <Reveal>
                <CostsCard report={report.data} ai={report.data.detail.ai} />
              </Reveal>
            </>
          ) : null}
          <ul className="grid gap-0.5 text-[11px] text-foreground-muted">
            {report.data.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
