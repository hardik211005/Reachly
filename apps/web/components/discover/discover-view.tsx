"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  Bookmark,
  Building2,
  Check,
  Download,
  History,
  Loader2,
  MapPin,
  Radar,
  Sparkles,
  Star,
  Telescope,
  Wand2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Label,
  ScoreIndicator,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
  formatNumber,
  toast,
} from "@repo/ui";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { AddToCampaignMenu, ContactIndicators, FitBadge, SignalBadges, SourceLabel, type LeadSignalView } from "../leads/shared";

// ----------------------------------------------------------------------------- Types

interface Criteria {
  categories: string[];
  keywords: string[];
  locations: Array<{ label: string; city: string | null; lat: number | null; lng: number | null }>;
  radiusKm: number;
  criteria: string | null;
  companySize: string | null;
  requireWebsite: boolean;
  requireContact: boolean;
  preferredSignals: string[];
  offer: string | null;
}

interface Stats {
  found: number;
  new: number;
  duplicates: number;
  enriched: number;
  scored: number;
  highFit: number;
  qualified: number;
  contactable: number;
  creditsExhausted: boolean;
}

interface Run {
  id: string;
  query: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
  stage: "QUEUED" | "PARSING" | "SEARCHING" | "NORMALIZING" | "ENRICHING" | "SCORING" | "DONE";
  stats: Stats;
  criteria: Criteria;
  error: string | null;
  providers: string[];
  createdAt: string;
  completedAt: string | null;
}

interface ResultLead {
  id: string;
  name: string;
  category: string | null;
  locality: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  rating: string | null;
  reviewCount: number | null;
  score: number | null;
  fitTier: "HIGH" | "MEDIUM" | "LOW" | null;
  qualification: string | null;
  enrichmentStatus: string;
  signals: LeadSignalView[];
  sourceProvider: string;
  locationsCount: number | null;
  aiSummary: string | null;
  isNew: boolean;
  contacts: Array<{ email: string | null; phone: string | null; name: string | null }>;
}

export interface DiscoverDefaults {
  offer: string;
  audience: string;
  location: string;
  radiusKm: number;
  campaign: { id: string; name: string } | null;
  maxResults: number;
}

const STAGES: Array<{ key: Run["stage"]; label: string }> = [
  { key: "SEARCHING", label: "Searching sources" },
  { key: "NORMALIZING", label: "Analyzing businesses" },
  { key: "ENRICHING", label: "Enriching contacts" },
  { key: "SCORING", label: "Scoring leads" },
  { key: "DONE", label: "Ready" },
];

function stageIndex(stage: Run["stage"]): number {
  const index = STAGES.findIndex((item) => item.key === stage);
  return index === -1 ? -1 : index;
}

function humanCategory(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ----------------------------------------------------------------------------- Search form

function SearchForm({
  defaults,
  onSearch,
  busy,
}: {
  defaults: DiscoverDefaults;
  onSearch: (input: { query: string; limit: number }) => void;
  busy: boolean;
}) {
  const [mode, setMode] = React.useState<"guided" | "describe">("guided");
  const [offer, setOffer] = React.useState(defaults.offer);
  const [audience, setAudience] = React.useState(defaults.audience);
  const [location, setLocation] = React.useState(defaults.location);
  const [radius, setRadius] = React.useState(String(defaults.radiusKm));
  const [description, setDescription] = React.useState("");
  const [limit, setLimit] = React.useState(String(Math.min(40, defaults.maxResults)));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query =
      mode === "describe"
        ? description.trim()
        : `Find ${audience.trim() || "businesses"}${location.trim() ? ` in ${location.trim()}` : ""} within ${radius} km${offer.trim() ? ` that may need ${offer.trim()}` : ""}`;
    if (query.length < 3) {
      toast.error("Describe the businesses you want to find");
      return;
    }
    onSearch({ query, limit: Number(limit) });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-surface p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "guided", label: "Guided" },
            { value: "describe", label: "Describe it" },
          ]}
        />
        {defaults.campaign ? (
          <Badge tone="accent">
            <Radar /> For campaign: {defaults.campaign.name}
          </Badge>
        ) : null}
      </div>

      {mode === "guided" ? (
        <div className="grid gap-4 md:grid-cols-[1.1fr_1.1fr_1fr_110px]">
          <Field>
            <Label htmlFor="offer">What are you selling?</Label>
            <Input id="offer" value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="Custom branded paper cups" />
          </Field>
          <Field>
            <Label htmlFor="audience">Who do you want to sell to?</Label>
            <Input id="audience" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Cafés, restaurants, cloud kitchens" />
          </Field>
          <Field>
            <Label htmlFor="location">Where?</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-foreground-muted" />
              <Input id="location" className="pl-8" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Delhi NCR" />
            </div>
          </Field>
          <Field>
            <Label>Radius</Label>
            <Select value={radius} onValueChange={setRadius}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["5", "10", "25", "50", "100"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value} km
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : (
        <Field>
          <Label htmlFor="description">What are you looking for?</Label>
          <Textarea
            id="description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Find cafés in South Delhi with 2+ locations that may need custom branded paper cups"
          />
        </Field>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <span>Up to</span>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="h-7 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 40, 60, 100, 150, 250]
                .filter((value) => value <= defaults.maxResults)
                .map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span>results · each new lead uses one lead credit</span>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          <Telescope /> Find leads
        </Button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------- Progress

function RunProgress({ run }: { run: Run }) {
  const current = run.status === "COMPLETED" ? STAGES.length - 1 : stageIndex(run.stage);
  const tiles = [
    { label: "Businesses found", value: run.stats.found, hint: run.stats.duplicates ? `${run.stats.duplicates} already in your leads` : undefined },
    { label: "Potential buyers", value: run.stats.qualified, hint: "Qualified by score" },
    { label: "High-fit leads", value: run.stats.highFit, hint: "Score ≥ high-fit threshold" },
    { label: "Contactable", value: run.stats.contactable, hint: "Email or phone available" },
  ];
  const active = run.status === "PENDING" || run.status === "RUNNING";
  return (
    <div className="grid gap-3">
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
        {STAGES.map((stage, index) => {
          const done = index < current || run.status === "COMPLETED";
          const inProgress = index === current && active;
          return (
            <li key={stage.key} className={cn("flex items-center gap-2 text-[13px]", !done && !inProgress && "text-foreground-subtle")}>
              {done ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-good text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              ) : inProgress ? (
                <Loader2 className="size-4 animate-spin text-accent" />
              ) : (
                <span className="size-4 rounded-full border border-border-strong" />
              )}
              <span className={cn(inProgress && "font-medium text-foreground")}>
                {stage.label}
                {inProgress ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs text-foreground-muted">{tile.label}</p>
            <p className="mt-1 text-[22px] leading-none font-semibold tabular transition-all">{formatNumber(tile.value)}</p>
            {tile.hint ? <p className="mt-1 text-[11px] text-foreground-subtle">{tile.hint}</p> : null}
          </div>
        ))}
      </div>
      {run.stats.creditsExhausted ? (
        <Callout tone="warning" icon={AlertTriangle} title="Lead credits ran out" action={<Button asChild size="sm"><Link href="/app/billing">View plan</Link></Button>}>
          Some businesses weren&apos;t saved because your plan&apos;s lead credits for this period are used up.
        </Callout>
      ) : null}
      {run.status === "FAILED" ? (
        <Callout tone="danger" icon={AlertTriangle} title="Discovery failed">
          {run.error ?? "The lead provider returned an error."}
        </Callout>
      ) : null}
    </div>
  );
}

function CriteriaSummary({ run, interpretation }: { run: Run; interpretation: string | null }) {
  const criteria = run.criteria;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-[13px]">
      <Wand2 className="mr-1 size-3.5 text-foreground-muted" />
      <span className="mr-1 text-foreground-muted">{interpretation ?? "Understood as"}</span>
      {criteria.categories.map((category) => (
        <Badge key={category} tone="accent">
          <Building2 /> {humanCategory(category)}
        </Badge>
      ))}
      {criteria.locations.map((location) => (
        <Badge key={location.label} tone="neutral">
          <MapPin /> {location.label} · {criteria.radiusKm} km
        </Badge>
      ))}
      {criteria.preferredSignals.map((signal) => (
        <Badge key={signal} tone="success">
          <Star /> {signal.replace(/_/g, " ")}
        </Badge>
      ))}
      {criteria.criteria ? <Badge tone="outline">{criteria.criteria}</Badge> : null}
      {criteria.offer ? <Badge tone="outline">Offer: {criteria.offer}</Badge> : null}
      <span className="ml-auto text-[11px] text-foreground-subtle">Source: {run.providers.map((p) => (p === "mock" ? "demo data (simulated)" : p)).join(", ")}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------- Results

function ResultsTable({ results, selected, onToggle, onToggleAll, scoring }: { results: ResultLead[]; selected: Set<string>; onToggle: (id: string) => void; onToggleAll: () => void; scoring: boolean }) {
  const allSelected = results.length > 0 && results.every((lead) => selected.has(lead.id));
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-9">
            <Checkbox
              aria-label="Select all results"
              checked={allSelected ? true : selected.size ? "indeterminate" : false}
              onCheckedChange={onToggleAll}
            />
          </TableHead>
          <TableHead className="w-14">Score</TableHead>
          <TableHead>Business</TableHead>
          <TableHead className="hidden lg:table-cell">Why it fits</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead className="hidden md:table-cell">Fit</TableHead>
          <TableHead className="hidden xl:table-cell">Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((lead) => (
          <TableRow key={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined} className="animate-fade-in">
            <TableCell>
              <Checkbox aria-label={`Select ${lead.name}`} checked={selected.has(lead.id)} onCheckedChange={() => onToggle(lead.id)} />
            </TableCell>
            <TableCell>
              {lead.score === null && scoring ? <Loader2 className="size-4 animate-spin text-foreground-muted" /> : <ScoreIndicator score={lead.score} />}
            </TableCell>
            <TableCell className="max-w-[260px]">
              <Link href={`/app/leads/${lead.id}`} className="block truncate font-medium hover:underline">
                {lead.name}
              </Link>
              <p className="truncate text-xs text-foreground-muted">
                {[lead.category ? humanCategory(lead.category) : null, lead.locality ?? lead.city, lead.reviewCount ? `${lead.rating ?? "–"}★ · ${lead.reviewCount} reviews` : null]
                  .filter(Boolean)
                  .join(" · ")}
                {!lead.isNew ? " · already in leads" : ""}
              </p>
            </TableCell>
            <TableCell className="hidden max-w-[320px] lg:table-cell">
              {lead.enrichmentStatus === "PENDING" || lead.enrichmentStatus === "ENRICHING" ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                <SignalBadges signals={lead.signals ?? []} />
              )}
            </TableCell>
            <TableCell>
              <ContactIndicators email={lead.email ?? lead.contacts.find((c) => c.email)?.email} phone={lead.phone ?? lead.contacts.find((c) => c.phone)?.phone} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <FitBadge tier={lead.fitTier} />
            </TableCell>
            <TableCell className="hidden xl:table-cell">
              <SourceLabel provider={lead.sourceProvider} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ----------------------------------------------------------------------------- History sidebar

function RunHistory({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string) => void }) {
  const runs = useQuery({ queryKey: ["discovery-runs"], queryFn: () => api<Run[]>("/api/v1/discovery?limit=12"), refetchInterval: 15_000 });
  const saved = useQuery({ queryKey: ["saved-searches"], queryFn: () => api<Array<{ id: string; name: string; query: string }>>("/api/v1/saved-searches") });
  return (
    <aside className="grid content-start gap-5">
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
          <Bookmark className="size-3.5" /> Saved searches
        </p>
        {saved.data?.length ? (
          <ul className="grid gap-0.5">
            {saved.data.map((search) => (
              <li key={search.id} className="truncate rounded-md px-2 py-1.5 text-[13px] text-foreground-secondary" title={search.query}>
                {search.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-foreground-subtle">Save a search to rerun it later.</p>
        )}
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
          <History className="size-3.5" /> Recent runs
        </p>
        {runs.isLoading ? <Skeleton className="h-20" /> : null}
        <ul className="grid gap-0.5">
          {(runs.data ?? []).map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted",
                  run.id === activeId && "bg-surface-muted",
                )}
              >
                <span className="line-clamp-2 text-[13px] text-foreground-secondary">{run.query}</span>
                <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                  {run.status === "COMPLETED" ? `${run.stats.new ?? 0} new · ${run.stats.highFit ?? 0} high-fit` : run.status.toLowerCase()} ·{" "}
                  {formatDistanceToNowStrict(new Date(run.createdAt), { addSuffix: true })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------------------- Page

export function DiscoverView({ defaults }: { defaults: DiscoverDefaults }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const runId = params.get("run");
  const [interpretation, setInterpretation] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const setRun = React.useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set("run", id);
      else next.delete("run");
      setSelected(new Set());
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const start = useMutation({
    mutationFn: async (input: { query: string; limit: number }) => {
      const parsed = await api<{ criteria: Criteria; interpretation: string }>("/api/v1/discovery/parse", {
        method: "POST",
        json: { query: input.query, campaignId: defaults.campaign?.id },
      });
      setInterpretation(parsed.interpretation);
      return api<Run>("/api/v1/discovery", {
        method: "POST",
        json: { query: input.query, criteria: parsed.criteria, limit: input.limit, campaignId: defaults.campaign?.id },
      });
    },
    onSuccess: (run) => {
      setRun(run.id);
      void queryClient.invalidateQueries({ queryKey: ["discovery-runs"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "PROVIDER_NOT_CONFIGURED") {
        toast.error("No lead data provider is connected", { description: "Connect one in Integrations to discover leads." });
      } else toast.error(errorMessage(error));
    },
  });

  const runQuery = useQuery({
    queryKey: ["discovery-run", runId],
    queryFn: () => api<{ run: Run; results: ResultLead[] }>(`/api/v1/discovery/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "PENDING" || status === "RUNNING" ? 1200 : false;
    },
  });

  const save = useMutation({
    mutationFn: (run: Run) => api("/api/v1/saved-searches", { method: "POST", json: { name: run.query.slice(0, 80), query: run.query, criteria: run.criteria } }),
    onSuccess: () => {
      toast.success("Search saved");
      void queryClient.invalidateQueries({ queryKey: ["saved-searches"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = runQuery.data;
  const runStatus = data?.run.status;
  React.useEffect(() => {
    // Refresh the history list once a run finishes.
    if (runStatus === "COMPLETED" || runStatus === "FAILED") void queryClient.invalidateQueries({ queryKey: ["discovery-runs"] });
  }, [runStatus, queryClient]);
  const results = data?.results ?? [];
  const running = data?.run.status === "PENDING" || data?.run.status === "RUNNING";

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="grid min-w-0 content-start gap-5">
        <SearchForm defaults={defaults} onSearch={(input) => start.mutate(input)} busy={start.isPending} />

        {!runId ? (
          <div className="rounded-xl border border-dashed border-border-strong">
            <EmptyState
              icon={Sparkles}
              title="Describe your ideal buyers and we'll find them"
              description="Every result shows where it came from, why it was selected and how it was scored. Nothing is contacted until you add leads to a campaign."
            />
          </div>
        ) : runQuery.isLoading ? (
          <Skeleton className="h-40" />
        ) : data ? (
          <>
            <CriteriaSummary run={data.run} interpretation={interpretation} />
            <RunProgress run={data.run} />
            <section className="rounded-lg border border-border bg-surface shadow-xs">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold">Results</span>
                  <span className="text-foreground-muted tabular">{results.length}</span>
                  {selected.size ? <Badge tone="accent">{selected.size} selected</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => save.mutate(data.run)} loading={save.isPending} disabled={running}>
                    <Bookmark /> Save search
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/v1/leads/export?discoveryRunId=${data.run.id}`} download>
                      <Download /> Export
                    </a>
                  </Button>
                  <AddToCampaignMenu leadIds={[...selected]} onDone={() => setSelected(new Set())} />
                  {selected.size ? (
                    <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                      <X />
                    </Button>
                  ) : null}
                </div>
              </header>
              {results.length === 0 ? (
                running ? (
                  <div className="grid gap-2 p-4">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-10" />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    icon={Telescope}
                    title="No businesses matched"
                    description="Try a broader area, a larger radius or different business types."
                  />
                )
              ) : (
                <ResultsTable
                  results={results}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={() => setSelected((current) => (results.every((lead) => current.has(lead.id)) ? new Set() : new Set(results.map((lead) => lead.id))))}
                  scoring={running}
                />
              )}
            </section>
          </>
        ) : runQuery.isError ? (
          <Callout tone="danger">{errorMessage(runQuery.error)}</Callout>
        ) : null}
      </div>
      <RunHistory activeId={runId} onSelect={(id) => setRun(id)} />
    </div>
  );
}
