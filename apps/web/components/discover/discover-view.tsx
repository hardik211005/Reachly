"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Building2,
  Check,
  Download,
  History,
  Lightbulb,
  Loader2,
  MapPin,
  Radar,
  ShieldCheck,
  Sparkles,
  Star,
  Telescope,
  Wand2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AnimatedNumber,
  Aurora,
  Badge,
  Button,
  Callout,
  Checkbox,
  EASE_OUT,
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
  Stagger,
  StaggerItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
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

export interface SearchIdea {
  audience: string;
  location: string;
  offer: string;
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

// ----------------------------------------------------------------------------- Search console

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
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }} className="relative isolate overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
      <Aurora intensity={1} className="-z-10" />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_65%)]" />
      <div className="px-5 pt-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em]">
              Find potential <span className="text-gradient animate-gradient-pan">customers</span>
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-foreground-secondary">Tell us what you sell and who buys it. We search approved data sources, enrich every business and score it against your ideal customer profile.</p>
          </div>
          {defaults.campaign ? (
            <Badge tone="accent">
              <Radar /> For campaign: {defaults.campaign.name}
            </Badge>
          ) : null}
        </div>
      </div>
      <form onSubmit={submit} className="m-3 mt-5 rounded-xl border border-border bg-surface/85 p-4 shadow-sm backdrop-blur sm:m-5 sm:p-5">
        <div className="mb-4">
          <SegmentedControl
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "guided", label: "Guided" },
              { value: "describe", label: "Describe it" },
            ]}
          />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {mode === "guided" ? (
            <motion.div key="guided" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="grid gap-4 md:grid-cols-[1.1fr_1.1fr_1fr_110px]">
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
                  <SelectTrigger aria-label="Radius">
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
            </motion.div>
          ) : (
            <motion.div key="describe" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
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
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <span>Up to</span>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger className="h-7 w-20" aria-label="Maximum results">
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
          <Button type="submit" variant="primary" size="lg" loading={busy} className="relative overflow-hidden px-5 shadow-[var(--brand-glow)]">
            <Telescope /> Find leads
            <span aria-hidden className="absolute inset-y-0 left-0 w-10 bg-white/25 blur-md" style={{ animation: "sheen 3.2s ease-in-out infinite" }} />
          </Button>
        </div>
      </form>
    </motion.section>
  );
}

// ----------------------------------------------------------------------------- Before the first search

const HOW = [
  { icon: Wand2, title: "Understand", body: "Your words become categories, places and signals you can check." },
  { icon: Telescope, title: "Search", body: "Approved sources are searched and duplicates removed." },
  { icon: Sparkles, title: "Enrich", body: "Websites and public profiles fill in contacts and signals." },
  { icon: Star, title: "Score", body: "Each lead is scored against your ideal customer, with reasons." },
];

function StartHere({ ideas, onPick }: { ideas: SearchIdea[]; onPick: (idea: SearchIdea) => void }) {
  return (
    <div className="grid gap-5">
      {ideas.length ? (
        <section>
          <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
            <Lightbulb className="size-4 text-brand-2" /> Ideas from your ideal customer profile
          </p>
          <Stagger step={0.05} className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {ideas.map((idea) => (
              <StaggerItem key={`${idea.audience}-${idea.location}`}>
                <button type="button" onClick={() => onPick(idea)} className="group lift flex h-full w-full items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-left shadow-xs transition-colors hover:border-border-strong">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
                    <Building2 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{idea.audience}</span>
                    <span className="flex items-center gap-1 text-[12px] text-foreground-muted">
                      <MapPin className="size-3" /> {idea.location}
                    </span>
                    {idea.offer ? <span className="mt-1 block truncate text-[11.5px] text-foreground-subtle">for {idea.offer}</span> : null}
                  </span>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ) : null}
      <section className="rounded-xl border border-dashed border-border-strong p-5">
        <p className="text-[13px] font-semibold">How discovery works</p>
        <ol className="relative mt-4 grid gap-4 sm:grid-cols-4">
          <motion.span aria-hidden initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 1, ease: EASE_OUT }} className="bg-brand-gradient absolute top-4 right-[12%] left-[12%] hidden h-px origin-left sm:block" />
          {HOW.map((step, index) => (
            <motion.li key={step.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + index * 0.12 }} className="relative text-center">
              <span className="relative mx-auto flex size-8 items-center justify-center rounded-full border border-border bg-surface shadow-sm">
                <step.icon className="size-4 text-brand-1" />
              </span>
              <p className="mt-2 text-[13px] font-semibold">{step.title}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground-muted">{step.body}</p>
            </motion.li>
          ))}
        </ol>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-foreground-muted">
          <ShieldCheck className="size-3.5 text-good" /> Nothing is contacted until you add leads to a campaign.
        </p>
      </section>
    </div>
  );
}

function RadarPulse() {
  const reduce = useReducedMotion();
  return (
    <span aria-hidden className="relative flex size-10 shrink-0 items-center justify-center">
      {reduce ? null : [0, 0.6, 1.2].map((delay) => <span key={delay} className="absolute inset-0 rounded-full border border-brand-1/40" style={{ animation: `pulse-ring 1.8s ease-out ${delay}s infinite` }} />)}
      <span className="bg-brand-gradient relative flex size-7 items-center justify-center rounded-full text-white shadow-[var(--brand-glow)]">
        <Radar className="size-3.5" />
      </span>
    </span>
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
  const progress = run.status === "COMPLETED" ? 100 : Math.max(0, current) * (100 / (STAGES.length - 1));
  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-border bg-surface px-4 py-3.5 shadow-xs">
        <div className="flex items-center gap-3">
          {active ? <RadarPulse /> : null}
          <ol className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2">
            {STAGES.map((stage, index) => {
              const done = index < current || run.status === "COMPLETED";
              const inProgress = index === current && active;
              return (
                <li key={stage.key} className={cn("flex items-center gap-2 text-[13px]", !done && !inProgress && "text-foreground-subtle")}>
                  {done ? (
                    <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="flex size-4 items-center justify-center rounded-full bg-good text-white">
                      <Check className="size-2.5" strokeWidth={3} />
                    </motion.span>
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
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-sunken">
          <motion.div className="bg-brand-gradient h-full rounded-full" initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="lift rounded-xl border border-border bg-surface px-4 py-3 shadow-xs">
            <p className="text-xs text-foreground-muted">{tile.label}</p>
            <p className="mt-1 text-[24px] leading-none font-semibold tracking-[-0.02em] tabular">
              <AnimatedNumber value={tile.value} duration={0.6} />
            </p>
            {tile.hint ? <p className="mt-1 text-[11px] text-foreground-subtle">{tile.hint}</p> : null}
          </div>
        ))}
      </div>
      {run.stats.creditsExhausted ? (
        <Callout
          tone="warning"
          icon={AlertTriangle}
          title="Lead credits ran out"
          action={
            <Button asChild size="sm">
              <Link href="/app/billing">View plan</Link>
            </Button>
          }
        >
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
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface/60 px-3 py-2.5 text-[13px]">
      <Wand2 className="mr-1 size-3.5 text-brand-1" />
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
      <span className="ml-auto text-[11px] text-foreground-subtle">
        Source: {run.providers.map((p) => (p === "mock" ? "demo data (simulated)" : p === "openstreetmap" ? "OpenStreetMap" : p === "google_places" ? "Google Places" : p)).join(", ")}
        {run.providers.includes("openstreetmap") ? (
          <>
            {" · "}
            {/* Required attribution for OpenStreetMap data (ODbL). */}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              © OpenStreetMap contributors
            </a>
          </>
        ) : null}
      </span>
    </motion.div>
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
            <Checkbox aria-label="Select all results" checked={allSelected ? true : selected.size ? "indeterminate" : false} onCheckedChange={onToggleAll} />
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
        {results.map((lead, index) => (
          <TableRow key={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined} className="animate-rise" style={{ animationDelay: `${Math.min(index, 20) * 35}ms` }}>
            <TableCell>
              <Checkbox aria-label={`Select ${lead.name}`} checked={selected.has(lead.id)} onCheckedChange={() => onToggle(lead.id)} />
            </TableCell>
            <TableCell>{lead.score === null && scoring ? <Loader2 className="size-4 animate-spin text-foreground-muted" /> : <ScoreIndicator score={lead.score} />}</TableCell>
            <TableCell className="max-w-[260px]">
              <Link href={`/app/leads/${lead.id}`} className="block truncate font-medium hover:underline">
                {lead.name}
              </Link>
              <p className="truncate text-xs text-foreground-muted">
                {[lead.category ? humanCategory(lead.category) : null, lead.locality ?? lead.city, lead.reviewCount ? `${lead.rating ?? "–"}★ · ${lead.reviewCount} reviews` : null].filter(Boolean).join(" · ")}
                {!lead.isNew ? " · already in leads" : ""}
              </p>
            </TableCell>
            <TableCell className="hidden max-w-[320px] lg:table-cell">{lead.enrichmentStatus === "PENDING" || lead.enrichmentStatus === "ENRICHING" ? <Skeleton className="h-4 w-40" /> : <SignalBadges signals={lead.signals ?? []} />}</TableCell>
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

/** Consecutive runs of the same search collapse into one entry (the latest) with a count. */
function groupRuns(runs: Run[]): Array<{ run: Run; repeats: number }> {
  const groups: Array<{ run: Run; repeats: number }> = [];
  for (const run of runs) {
    const last = groups[groups.length - 1];
    if (last && last.run.query.trim().toLowerCase() === run.query.trim().toLowerCase()) last.repeats += 1;
    else groups.push({ run, repeats: 1 });
  }
  return groups;
}

function RunHistory({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string) => void }) {
  const runs = useQuery({ queryKey: ["discovery-runs"], queryFn: () => api<Run[]>("/api/v1/discovery?limit=12"), refetchInterval: 15_000 });
  const saved = useQuery({ queryKey: ["saved-searches"], queryFn: () => api<Array<{ id: string; name: string; query: string }>>("/api/v1/saved-searches") });
  return (
    <aside className="grid content-start gap-5 xl:sticky xl:top-20">
      <div className="rounded-xl border border-border bg-surface p-3 shadow-xs">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-foreground-muted">
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
          <p className="px-1 text-xs text-foreground-subtle">Save a search to rerun it later.</p>
        )}
      </div>
      <div className="rounded-xl border border-border bg-surface p-3 shadow-xs">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-foreground-muted">
          <History className="size-3.5" /> Recent runs
        </p>
        {runs.isLoading ? <Skeleton className="h-20" /> : null}
        <ul className="grid gap-0.5">
          {groupRuns(runs.data ?? []).map(({ run, repeats }) => (
            <li key={run.id}>
              <button type="button" onClick={() => onSelect(run.id)} className={cn("relative w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted", run.id === activeId && "bg-surface-muted")}>
                {run.id === activeId ? <span className="bg-brand-gradient absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" /> : null}
                <span className="line-clamp-2 text-[13px] text-foreground-secondary">
                  {run.query}
                  {repeats > 1 ? <span className="ml-1.5 rounded-sm bg-surface-sunken px-1 text-[10.5px] font-medium text-foreground-muted">×{repeats}</span> : null}
                </span>
                <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                  {run.status === "COMPLETED" ? `${run.stats.new ?? 0} new · ${run.stats.highFit ?? 0} high-fit` : run.status.toLowerCase()} · {formatDistanceToNowStrict(new Date(run.createdAt), { addSuffix: true })}
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

export function DiscoverView({ defaults, ideas = [] }: { defaults: DiscoverDefaults; ideas?: SearchIdea[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const runId = params.get("run");
  const [interpretation, setInterpretation] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Picking an idea re-mounts the form with those values filled in.
  const [preset, setPreset] = React.useState<{ key: number; values: DiscoverDefaults } | null>(null);

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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 content-start gap-5">
        <SearchForm key={preset?.key ?? 0} defaults={preset?.values ?? defaults} onSearch={(input) => start.mutate(input)} busy={start.isPending} />

        {!runId ? (
          <StartHere
            ideas={ideas}
            onPick={(idea) => {
              setPreset((current) => ({ key: (current?.key ?? 0) + 1, values: { ...defaults, audience: idea.audience, location: idea.location, offer: idea.offer || defaults.offer } }));
              window.scrollTo({ top: 0, behavior: "smooth" });
              toast.success("Search filled in", { description: "Check the details, then press Find leads." });
            }}
          />
        ) : runQuery.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : data ? (
          <>
            <CriteriaSummary run={data.run} interpretation={interpretation} />
            <RunProgress run={data.run} />
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
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
                  <EmptyState compact icon={Telescope} title="No businesses matched" description="Try a broader area, a larger radius or different business types." />
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
