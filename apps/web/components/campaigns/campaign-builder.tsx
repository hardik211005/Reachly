"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Braces,
  Check,
  Eye,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { AUTOMATION_MODE_LABELS, AUTOMATION_MODES, CHANNEL_LABELS, type AutomationMode, type Channel } from "@repo/config";
import { getCategory } from "@repo/config/taxonomy";
import { DEFAULT_DAILY_LIMITS, defaultSequence, type CampaignStepInput } from "@repo/core/campaigns/schemas";
import {
  Badge,
  Button,
  Callout,
  CompanyMark,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  RadioCard,
  RadioGroup,
  ScoreIndicator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
  cn,
  formatNumber,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { ChannelIcon, ProviderPill, TEMPLATE_VARIABLES, type ProviderState } from "../outreach/shared";

// ----------------------------------------------------------------------------- Props & state

export interface BuilderOptions {
  offerings: Array<{ id: string; name: string; description: string | null; price: string | null }>;
  categories: Array<{ value: string; count: number }>;
  cities: Array<{ value: string; count: number }>;
  plan: { name: string; automationModes: AutomationMode[]; channels: Channel[] };
  providers: { EMAIL: ProviderState; WHATSAPP: ProviderState };
  voiceAvailable: boolean;
  templates: Array<{ id: string; name: string; body: string; status: string; language: string }>;
  defaultTone: string;
}

interface StepDraft extends CampaignStepInput {
  key: string;
  whatsappTemplateId: string | null;
}

interface BuilderState {
  name: string;
  description: string;
  offeringIds: string[];
  offerSummary: string;
  pitchAngle: string;
  tone: string;
  audience: { categories: string[]; cities: string[]; minScore: number; statuses: string[]; qualifiedOnly: boolean };
  channels: Channel[];
  automationMode: AutomationMode;
  dailyLimits: Partial<Record<Channel, number>>;
  steps: StepDraft[];
}

interface AudiencePreview {
  total: number;
  matched: number;
  withEmail: number;
  withPhone: number;
  capped: boolean;
  sample: Array<{ id: string; name: string; category: string | null; city: string | null; locality: string | null; score: number | null }>;
}

const STEPS = [
  { key: "offer", label: "Offer", description: "What you’re pitching" },
  { key: "audience", label: "Audience", description: "Who receives it" },
  { key: "channels", label: "Channels", description: "How and how much" },
  { key: "sequence", label: "Sequence", description: "What gets sent, when" },
  { key: "review", label: "Review", description: "Check and create" },
] as const;

const TONES = ["professional", "friendly", "consultative", "direct", "warm and casual"];

let stepCounter = 0;
function withKeys(steps: CampaignStepInput[]): StepDraft[] {
  return steps.map((step) => ({ ...step, key: `step-${(stepCounter += 1)}`, whatsappTemplateId: null }));
}

function categoryLabel(key: string): string {
  return getCategory(key)?.label ?? key.replace(/_/g, " ");
}

// ----------------------------------------------------------------------------- Small building blocks

function Section({ title, description, children, aside }: { title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-xs">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-foreground-muted">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ToggleChip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground-secondary hover:border-border-strong hover:text-foreground",
      )}
    >
      {active ? <Check className="size-3" /> : null}
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------- Step 1: offer

function OfferStep({ state, update, options }: { state: BuilderState; update: (patch: Partial<BuilderState>) => void; options: BuilderOptions }) {
  return (
    <div className="grid gap-4">
      <Section title="Name this campaign" description="Internal only — recipients never see it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input id="campaign-name" value={state.name} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Delhi cafés — packaging pilot" autoFocus />
          </Field>
          <Field>
            <Label htmlFor="campaign-description">Goal (optional)</Label>
            <Input id="campaign-description" value={state.description} onChange={(event) => update({ description: event.target.value })} placeholder="e.g. Book 10 sampling calls this month" />
          </Field>
        </div>
      </Section>

      <Section title="What are you offering?" description="The AI only mentions products, prices and claims you configure here — never invented ones.">
        {options.offerings.length ? (
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            {options.offerings.map((offering) => {
              const active = state.offeringIds.includes(offering.id);
              return (
                <button
                  key={offering.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const offeringIds = active ? state.offeringIds.filter((id) => id !== offering.id) : [...state.offeringIds, offering.id];
                    const first = options.offerings.find((item) => offeringIds.includes(item.id));
                    update({ offeringIds, offerSummary: state.offerSummary || (first ? (first.description ?? first.name) : "") });
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-[border,box-shadow]",
                    active ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]" : "border-border hover:border-border-strong",
                  )}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border", active ? "border-foreground bg-foreground text-background" : "border-border-strong")}>
                    {active ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{offering.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-foreground-muted">{[offering.price, offering.description].filter(Boolean).join(" · ") || "No price set"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <Callout tone="neutral" className="mb-4" action={<Link href="/app/settings" className="text-xs font-medium text-accent hover:underline">Add offerings</Link>}>
            No products or services configured yet. Messages will describe your offer from the summary below, without prices.
          </Callout>
        )}
        <div className="grid gap-4">
          <Field>
            <Label htmlFor="offer-summary">Offer in one or two sentences</Label>
            <Textarea id="offer-summary" rows={2} value={state.offerSummary} onChange={(event) => update({ offerSummary: event.target.value })} placeholder="Custom-printed eco-friendly takeaway cups and sleeves, with low minimums for independent cafés." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field>
              <Label htmlFor="pitch-angle">Pitch angle (optional)</Label>
              <Input id="pitch-angle" value={state.pitchAngle} onChange={(event) => update({ pitchAngle: event.target.value })} placeholder="e.g. Branded cups turn every takeaway into marketing" />
              <FieldHint>The one idea every message should land.</FieldHint>
            </Field>
            <Field>
              <Label>Tone</Label>
              <Select value={state.tone} onValueChange={(tone) => update({ tone })}>
                <SelectTrigger aria-label="Tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([state.tone, ...TONES])].map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      <span className="capitalize">{tone}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ----------------------------------------------------------------------------- Step 2: audience

function useAudiencePreview(audience: BuilderState["audience"], channels: Channel[]) {
  const filters = React.useMemo(
    () => ({
      category: audience.categories.length ? audience.categories.join(",") : undefined,
      city: audience.cities.length ? audience.cities.join(",") : undefined,
      minScore: audience.minScore || undefined,
      status: audience.statuses.join(","),
      qualification: audience.qualifiedOnly ? "QUALIFIED" : undefined,
      hasEmail: channels.length === 1 && channels[0] === "EMAIL" ? "true" : undefined,
    }),
    [audience, channels],
  );
  const [debounced, setDebounced] = React.useState(filters);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filters), 300);
    return () => window.clearTimeout(timer);
  }, [filters]);
  const query = useQuery({
    queryKey: ["audience-preview", debounced],
    queryFn: () => api<AudiencePreview>("/api/v1/campaigns/audience-preview", { method: "POST", json: debounced }),
    placeholderData: (previous) => previous,
  });
  return { ...query, filters: debounced };
}

function AudienceStep({ state, update, options, preview }: { state: BuilderState; update: (patch: Partial<BuilderState>) => void; options: BuilderOptions; preview: ReturnType<typeof useAudiencePreview> }) {
  const audience = state.audience;
  const setAudience = (patch: Partial<BuilderState["audience"]>) => update({ audience: { ...audience, ...patch } });
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid content-start gap-4">
        <Section title="Categories" description="Leave empty to include every category.">
          <div className="flex flex-wrap gap-1.5">
            {options.categories.map((item) => (
              <ToggleChip key={item.value} active={audience.categories.includes(item.value)} onClick={() => setAudience({ categories: toggle(audience.categories, item.value) })}>
                {categoryLabel(item.value)} <span className="opacity-60 tabular">{item.count}</span>
              </ToggleChip>
            ))}
            {!options.categories.length ? <p className="text-[13px] text-foreground-muted">No leads yet — discover some first.</p> : null}
          </div>
        </Section>
        <Section title="Cities" description="Leave empty to include every city.">
          <div className="flex flex-wrap gap-1.5">
            {options.cities.map((item) => (
              <ToggleChip key={item.value} active={audience.cities.includes(item.value)} onClick={() => setAudience({ cities: toggle(audience.cities, item.value) })}>
                {item.value} <span className="opacity-60 tabular">{item.count}</span>
              </ToggleChip>
            ))}
          </div>
        </Section>
        <Section title="Quality bar" description="Only reach out to leads that fit. Scores are explained on every lead.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <div className="flex items-center justify-between">
                <Label htmlFor="min-score">Minimum lead score</Label>
                <span className="text-[13px] font-semibold tabular">{audience.minScore}</span>
              </div>
              <input
                id="min-score"
                type="range"
                min={0}
                max={95}
                step={5}
                value={audience.minScore}
                onChange={(event) => setAudience({ minScore: Number(event.target.value) })}
                className="mt-2 w-full accent-[var(--foreground)]"
              />
              <div className="flex justify-between text-[11px] text-foreground-subtle">
                <span>Everyone</span>
                <span>High fit only</span>
              </div>
            </Field>
            <div className="grid content-start gap-3">
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium">Qualified leads only</span>
                  <span className="block text-xs text-foreground-muted">Excludes “needs review” leads</span>
                </span>
                <Switch checked={audience.qualifiedOnly} onCheckedChange={(qualifiedOnly) => setAudience({ qualifiedOnly })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium">Include already-contacted leads</span>
                  <span className="block text-xs text-foreground-muted">Otherwise only New and Qualified</span>
                </span>
                <Switch
                  checked={audience.statuses.includes("CONTACTED")}
                  onCheckedChange={(value) => setAudience({ statuses: value ? ["NEW", "QUALIFIED", "CONTACTED"] : ["NEW", "QUALIFIED"] })}
                />
              </label>
            </div>
          </div>
        </Section>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground-muted">Matching leads</p>
            {preview.isFetching ? <Spinner className="size-3.5" /> : null}
          </div>
          {preview.data ? (
            <>
              <p className="mt-1 text-3xl font-semibold tracking-[-0.02em] tabular">{formatNumber(preview.data.matched)}</p>
              {preview.data.capped ? <p className="text-xs text-warning-text">The first {formatNumber(preview.data.total)} (highest scores) will be added.</p> : null}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-surface-muted px-2.5 py-2">
                  <p className="text-foreground-muted">With email</p>
                  <p className="text-sm font-semibold tabular">{formatNumber(preview.data.withEmail)}</p>
                </div>
                <div className="rounded-md bg-surface-muted px-2.5 py-2">
                  <p className="text-foreground-muted">With phone</p>
                  <p className="text-sm font-semibold tabular">{formatNumber(preview.data.withPhone)}</p>
                </div>
              </div>
              {preview.data.sample.length ? (
                <ul className="mt-4 grid gap-2 border-t border-border pt-3">
                  {preview.data.sample.map((lead) => (
                    <li key={lead.id} className="flex items-center gap-2.5">
                      <CompanyMark name={lead.name} className="size-6 text-[10px]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{lead.name}</p>
                        <p className="truncate text-[11px] text-foreground-muted">{[lead.locality, lead.city].filter(Boolean).join(", ")}</p>
                      </div>
                      <ScoreIndicator score={lead.score} size="sm" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-foreground-muted">No leads match. Loosen the filters or discover more leads.</p>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-foreground-subtle">Do-not-contact, unsubscribed and suppressed leads — and leads already in another running campaign — are always excluded.</p>
            </>
          ) : (
            <Skeleton className="mt-2 h-40" />
          )}
        </div>
      </aside>
    </div>
  );
}

// ----------------------------------------------------------------------------- Step 3: channels & mode

const CHANNEL_DESCRIPTIONS: Record<Channel, string> = {
  EMAIL: "Personalised emails with unsubscribe links and threading.",
  WHATSAPP: "Official WhatsApp Business API. Opted-in contacts and approved templates only.",
  VOICE: "AI voice agent calls with consent checks and transcripts.",
  MANUAL_CALL: "Call tasks for your team with an AI-prepared script.",
};

function ChannelsStep({ state, update, options }: { state: BuilderState; update: (patch: Partial<BuilderState>) => void; options: BuilderOptions }) {
  const toggleChannel = (channel: Channel) => {
    const channels = state.channels.includes(channel) ? state.channels.filter((item) => item !== channel) : [...state.channels, channel];
    update({ channels, steps: withKeys(defaultSequence(channels.length ? channels : ["EMAIL"])) });
  };
  return (
    <div className="grid gap-4">
      <Section title="Channels" description="Changing channels resets the sequence to a sensible default you can edit next.">
        <div className="grid gap-2 sm:grid-cols-2">
          {(["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"] as const).map((channel) => {
            const inPlan = options.plan.channels.includes(channel);
            const provider = channel === "EMAIL" || channel === "WHATSAPP" ? options.providers[channel] : null;
            const unavailable = !inPlan || (provider !== null && !provider.ok) || (channel === "VOICE" && !options.voiceAvailable);
            const active = state.channels.includes(channel);
            return (
              <button
                key={channel}
                type="button"
                disabled={unavailable && !active}
                aria-pressed={active}
                onClick={() => toggleChannel(channel)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-[border,box-shadow] disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]" : "border-border hover:border-border-strong",
                )}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", active ? "border-foreground bg-foreground text-background" : "border-border bg-surface-muted text-foreground-secondary")}>
                  <ChannelIcon channel={channel} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{CHANNEL_LABELS[channel]}</span>
                    {!inPlan ? (
                      <Badge tone="outline">
                        <Lock /> Upgrade
                      </Badge>
                    ) : provider ? (
                      <ProviderPill state={provider} />
                    ) : channel === "VOICE" && !options.voiceAvailable ? (
                      <Badge tone="outline">Finish calling setup</Badge>
                    ) : channel === "VOICE" ? (
                      <Badge tone="success">Ready</Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-foreground-muted">{CHANNEL_DESCRIPTIONS[channel]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Automation mode" description="You can change this later. Automated sends always respect send windows, daily limits and opt-outs.">
        <RadioGroup value={state.automationMode} onValueChange={(value) => update({ automationMode: value as AutomationMode })} className="grid gap-2 sm:grid-cols-3">
          {AUTOMATION_MODES.map((mode) => {
            const inPlan = options.plan.automationModes.includes(mode);
            return (
              <RadioCard key={mode} value={mode} disabled={!inPlan}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{AUTOMATION_MODE_LABELS[mode].label}</span>
                  {!inPlan ? (
                    <Badge tone="outline">
                      <Lock /> Upgrade
                    </Badge>
                  ) : mode === "ASSISTED" ? (
                    <Badge tone="accent">Recommended</Badge>
                  ) : null}
                </span>
                <span className="text-xs leading-relaxed text-foreground-muted">{AUTOMATION_MODE_LABELS[mode].description}</span>
              </RadioCard>
            );
          })}
        </RadioGroup>
        {state.automationMode === "AUTOMATED" ? (
          <Callout tone="neutral" className="mt-3">
            First-touch messages still go to your review queue unless you turn that off in compliance settings.
          </Callout>
        ) : null}
      </Section>

      <Section title="Daily limits" description="Protects your sender reputation and keeps volume human.">
        <div className="grid gap-3 sm:grid-cols-4">
          {state.channels.map((channel) => (
            <Field key={channel}>
              <Label htmlFor={`limit-${channel}`} className="flex items-center gap-1.5">
                <ChannelIcon channel={channel} className="size-3" /> {CHANNEL_LABELS[channel]}
              </Label>
              <Input
                id={`limit-${channel}`}
                type="number"
                min={0}
                max={5000}
                value={state.dailyLimits[channel] ?? DEFAULT_DAILY_LIMITS[channel]}
                onChange={(event) => update({ dailyLimits: { ...state.dailyLimits, [channel]: Math.max(0, Number(event.target.value) || 0) } })}
              />
              <FieldHint>per day</FieldHint>
            </Field>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ----------------------------------------------------------------------------- Step 4: sequence

interface PreviewResult {
  subject: string | null;
  body: string;
  personalization: string[];
  ai: boolean;
  simulated: boolean;
  credits: number;
  lead: { id: string; name: string };
}

function StepCard({
  step,
  index,
  total,
  channels,
  templates,
  selected,
  onSelect,
  onChange,
  onMove,
  onRemove,
}: {
  step: StepDraft;
  index: number;
  total: number;
  channels: Channel[];
  templates: BuilderOptions["templates"];
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<StepDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const insertVariable = (key: string) => {
    const textarea = bodyRef.current;
    const token = `{{${key}}}`;
    if (!textarea) return onChange({ body: `${step.body}${token}` });
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    onChange({ body: `${step.body.slice(0, start)}${token}${step.body.slice(end)}` });
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const isMessage = step.channel === "EMAIL" || step.channel === "WHATSAPP";
  const approvedTemplates = templates.filter((template) => template.status === "APPROVED");

  return (
    <div className="relative pl-10">
      <span aria-hidden className={cn("absolute top-0 left-[15px] w-px bg-border", index === total - 1 ? "h-4" : "h-full")} />
      <span className={cn("absolute top-3 left-0 flex size-[31px] items-center justify-center rounded-full border bg-background text-xs font-semibold tabular", selected ? "border-foreground" : "border-border")}>
        {index + 1}
      </span>
      {index > 0 ? (
        <p className="mb-2 pt-1 text-xs text-foreground-muted">
          Wait{" "}
          <input
            type="number"
            min={0}
            max={60}
            value={step.delayDays}
            onChange={(event) => onChange({ delayDays: Math.max(0, Math.min(60, Number(event.target.value) || 0)) })}
            className="mx-1 h-6 w-12 rounded-sm border border-border bg-surface px-1.5 text-center text-xs text-foreground tabular"
            aria-label={`Days before step ${index + 1}`}
          />
          day{step.delayDays === 1 ? "" : "s"}, then if there’s{" "}
          <button type="button" className="font-medium text-foreground underline decoration-dotted underline-offset-2" onClick={() => onChange({ condition: step.condition === "ALWAYS" ? "NO_REPLY" : "ALWAYS" })}>
            {step.condition === "ALWAYS" ? "any outcome" : "no reply"}
          </button>
        </p>
      ) : null}
      <div
        className={cn("mb-4 rounded-lg border bg-surface shadow-xs transition-[border,box-shadow]", selected ? "border-foreground/70 shadow-[0_0_0_1px_var(--foreground)]" : "border-border")}
        onFocusCapture={onSelect}
        onClick={onSelect}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Select value={step.channel} onValueChange={(channel) => onChange({ channel: channel as Channel, subject: channel === "EMAIL" ? (step.subject ?? "") : null })}>
            <SelectTrigger className="h-7 w-auto gap-2 text-xs" aria-label="Channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channels.map((channel) => (
                <SelectItem key={channel} value={channel}>
                  <span className="inline-flex items-center gap-1.5">
                    <ChannelIcon channel={channel} className="size-3" /> {CHANNEL_LABELS[channel]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={step.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-[13px] font-semibold shadow-none hover:border-border focus-visible:border-border"
            aria-label="Step name"
          />
          <div className="ml-auto flex items-center gap-0.5">
            <Button size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
              <ArrowUp />
            </Button>
            <Button size="icon-xs" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
              <ArrowDown />
            </Button>
            <Button size="icon-xs" variant="ghost" disabled={total === 1} onClick={onRemove} aria-label="Remove step">
              <Trash2 />
            </Button>
          </div>
        </div>
        <div className="grid gap-2 p-3">
          {step.channel === "EMAIL" ? (
            <Input value={step.subject ?? ""} onChange={(event) => onChange({ subject: event.target.value })} placeholder="Subject line" aria-label="Subject" className="font-medium" />
          ) : null}
          {step.channel === "WHATSAPP" ? (
            <div className="grid gap-1.5 rounded-md border border-dashed border-border bg-surface-muted/50 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">Approved template (to start the conversation)</span>
                <Select value={step.whatsappTemplateId ?? "none"} onValueChange={(value) => onChange({ whatsappTemplateId: value === "none" ? null : value })}>
                  <SelectTrigger className="h-7 w-56 text-xs" aria-label="WhatsApp template">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template</SelectItem>
                    {approvedTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} · {template.language}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] leading-relaxed text-foreground-muted">
                WhatsApp only allows business-initiated messages through Meta-approved templates. Without one, this step is skipped unless the lead messaged you in the last 24 hours.{" "}
                {!approvedTemplates.length ? (
                  <Link href="/app/whatsapp" className="font-medium text-accent hover:underline">
                    Manage templates
                  </Link>
                ) : null}
              </p>
            </div>
          ) : null}
          <Textarea
            ref={bodyRef}
            value={step.body}
            onChange={(event) => onChange({ body: event.target.value })}
            rows={isMessage ? 6 : 3}
            aria-label={isMessage ? "Message template" : "Call brief"}
            placeholder={isMessage ? "Write the message template…" : "What should the call cover?"}
            className="font-[inherit] leading-relaxed"
          />
          {isMessage ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="ghost" className="text-foreground-secondary">
                    <Braces /> Insert variable
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <DropdownMenuItem key={variable.key} onSelect={() => insertVariable(variable.key)}>
                      <span className="flex-1">{variable.label}</span>
                      <span className="font-mono text-[10.5px] text-foreground-muted">{`{{${variable.key}}}`}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip content="AI rewrites this template for each lead using their real data. Off: variables are filled in exactly as written.">
                <label className="inline-flex items-center gap-2 text-xs text-foreground-secondary">
                  <Sparkles className="size-3 text-accent" /> AI personalise
                  <Switch checked={step.useAI ?? true} onCheckedChange={(useAI) => onChange({ useAI })} />
                </label>
              </Tooltip>
            </div>
          ) : (
            <p className="text-[11px] text-foreground-muted">
              {step.channel === "VOICE" ? "The AI voice agent uses this brief, consent rules and your offer. Calls stop on opt-out." : "Creates a call task with this brief for whoever owns the lead."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({ state, step, sample }: { state: BuilderState; step: StepDraft | undefined; sample: AudiencePreview["sample"] }) {
  const [leadId, setLeadId] = React.useState<string | null>(null);
  const activeLead = leadId && sample.some((lead) => lead.id === leadId) ? leadId : (sample[0]?.id ?? null);
  const preview = useMutation({
    mutationFn: (useAI: boolean) =>
      api<PreviewResult>("/api/v1/campaigns/preview-message", {
        method: "POST",
        json: {
          leadId: activeLead,
          channel: step?.channel,
          stepName: step?.name,
          stepOrder: step ? state.steps.indexOf(step) : 0,
          subject: step?.channel === "EMAIL" ? step.subject || null : null,
          body: step?.body,
          useAI,
          tone: state.tone,
          offerSummary: state.offerSummary || null,
          pitchAngle: state.pitchAngle || null,
          offeringIds: state.offeringIds,
        },
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const { mutate } = preview;
  const isMessage = step?.channel === "EMAIL" || step?.channel === "WHATSAPP";
  const signature = `${activeLead}|${step?.key}|${step?.channel}|${step?.subject}|${step?.body}|${state.offerSummary}|${state.tone}`;
  React.useEffect(() => {
    if (!activeLead || !isMessage || !step?.body.trim()) return;
    const timer = window.setTimeout(() => mutate(false), 400);
    return () => window.clearTimeout(timer);
  }, [signature, activeLead, isMessage, step?.body, mutate]);

  return (
    <aside className="xl:sticky xl:top-4 xl:self-start">
      <div className="rounded-lg border border-border bg-surface shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
            <Eye className="size-3.5" /> Preview
          </span>
          {sample.length ? (
            <Select value={activeLead ?? undefined} onValueChange={setLeadId}>
              <SelectTrigger className="h-7 w-44 text-xs" aria-label="Preview lead">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sample.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <div className="p-4">
          {!sample.length ? (
            <p className="text-[13px] text-foreground-muted">Add leads to the audience to preview messages with real lead data.</p>
          ) : !isMessage ? (
            <p className="text-[13px] text-foreground-muted">Call steps don’t send a message — they create a call {step?.channel === "VOICE" ? "for the AI voice agent" : "task"} with the brief.</p>
          ) : preview.data ? (
            <div className={cn("grid gap-2 transition-opacity", preview.isPending && "opacity-50")}>
              {preview.data.subject ? <p className="text-[13px] font-semibold">{preview.data.subject}</p> : null}
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary">{preview.data.body}</p>
              {preview.data.personalization.length ? (
                <div className="mt-2 grid gap-1 border-t border-border pt-2">
                  <p className="text-[11px] font-medium text-foreground-muted">Personalised using</p>
                  {preview.data.personalization.map((note) => (
                    <p key={note} className="flex items-start gap-1.5 text-xs text-foreground-secondary">
                      <Check className="mt-0.5 size-3 shrink-0 text-success-text" /> {note}
                    </p>
                  ))}
                </div>
              ) : null}
              {preview.data.ai ? (
                <p className="text-[11px] text-foreground-muted">
                  AI version{preview.data.simulated ? " (demo AI — deterministic)" : ""} · {preview.data.credits} credit{preview.data.credits === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
          ) : (
            <Skeleton className="h-32" />
          )}
        </div>
        {isMessage && sample.length && step?.useAI ? (
          <div className="border-t border-border px-4 py-2.5">
            <Button size="sm" variant="secondary" className="w-full" disabled={preview.isPending} onClick={() => preview.mutate(true)}>
              {preview.isPending ? <Spinner className="size-3.5" /> : <Sparkles />} Preview AI personalisation
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-foreground-subtle">Uses AI credits. Without it you see the template filled in.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function SequenceStep({ state, update, options, sample }: { state: BuilderState; update: (patch: Partial<BuilderState>) => void; options: BuilderOptions; sample: AudiencePreview["sample"] }) {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const selected = state.steps.find((step) => step.key === selectedKey) ?? state.steps[0];
  const setSteps = (steps: StepDraft[]) => update({ steps });
  const change = (key: string, patch: Partial<StepDraft>) => setSteps(state.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)));

  return (
    <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {state.steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            total={state.steps.length}
            channels={state.channels}
            templates={options.templates}
            selected={step.key === selected?.key}
            onSelect={() => setSelectedKey(step.key)}
            onChange={(patch) => change(step.key, patch)}
            onMove={(direction) => {
              const next = [...state.steps];
              const [item] = next.splice(index, 1);
              if (item) next.splice(index + direction, 0, item);
              setSteps(next);
            }}
            onRemove={() => setSteps(state.steps.filter((item) => item.key !== step.key))}
          />
        ))}
        <div className="pl-10">
          <Button
            size="sm"
            variant="secondary"
            disabled={state.steps.length >= 10}
            onClick={() => {
              const channel = state.channels.includes("EMAIL") ? "EMAIL" : (state.channels[0] ?? "EMAIL");
              const [step] = withKeys([
                {
                  channel,
                  delayDays: 3,
                  condition: "NO_REPLY",
                  name: `Follow-up ${state.steps.length}`,
                  subject: channel === "EMAIL" ? "Re: {{business_name}}" : null,
                  body: "Hi {{first_name}}, {{follow_up_hook}}",
                  useAI: true,
                },
              ]);
              if (step) {
                setSteps([...state.steps, step]);
                setSelectedKey(step.key);
              }
            }}
          >
            <Plus /> Add step
          </Button>
          <p className="mt-3 text-xs text-foreground-muted">
            A reply, opt-out or bounce always stops the sequence for that lead. Follow-ups never go to someone who already answered.
          </p>
        </div>
      </div>
      <PreviewPanel state={state} step={selected} sample={sample} />
    </div>
  );
}

// ----------------------------------------------------------------------------- Step 5: review

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-foreground-muted">{label}</dt>
      <dd className="text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

function ReviewStep({ state, options, preview }: { state: BuilderState; options: BuilderOptions; preview: AudiencePreview | undefined }) {
  const offerings = options.offerings.filter((offering) => state.offeringIds.includes(offering.id));
  const whatsappWithoutTemplate = state.steps.filter((step) => step.channel === "WHATSAPP" && !step.whatsappTemplateId).length;
  const simulated = state.channels.filter((channel) => (channel === "EMAIL" || channel === "WHATSAPP") && options.providers[channel].simulated);
  return (
    <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Summary" description="The campaign is created as a draft. You’ll see a cost and volume estimate and confirm before anything is sent.">
        <dl>
          <ReviewRow label="Name">{state.name}</ReviewRow>
          <ReviewRow label="Offer">
            {state.offerSummary || <span className="text-foreground-muted">From your business profile</span>}
            {offerings.length ? <span className="mt-1 block text-xs text-foreground-muted">{offerings.map((offering) => offering.name).join(" · ")}</span> : null}
          </ReviewRow>
          <ReviewRow label="Audience">
            {preview ? `${formatNumber(Math.min(preview.matched, preview.total))} leads` : "—"}
            <span className="mt-1 block text-xs text-foreground-muted">
              {[
                state.audience.categories.length ? state.audience.categories.map(categoryLabel).join(", ") : "All categories",
                state.audience.cities.length ? state.audience.cities.join(", ") : "all cities",
                `score ≥ ${state.audience.minScore}`,
                state.audience.qualifiedOnly ? "qualified only" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </ReviewRow>
          <ReviewRow label="Channels">
            <span className="flex flex-wrap gap-1.5">
              {state.channels.map((channel) => (
                <Badge key={channel} tone="neutral">
                  <ChannelIcon channel={channel} /> {CHANNEL_LABELS[channel]} · {state.dailyLimits[channel] ?? DEFAULT_DAILY_LIMITS[channel]}/day
                </Badge>
              ))}
            </span>
          </ReviewRow>
          <ReviewRow label="Mode">
            {AUTOMATION_MODE_LABELS[state.automationMode].label}
            <span className="mt-0.5 block text-xs text-foreground-muted">{AUTOMATION_MODE_LABELS[state.automationMode].description}</span>
          </ReviewRow>
          <ReviewRow label="Sequence">
            <ol className="grid gap-1.5">
              {state.steps.map((step, index) => (
                <li key={step.key} className="flex items-center gap-2 text-[13px]">
                  <span className="flex size-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold tabular">{index + 1}</span>
                  <ChannelIcon channel={step.channel} className="size-3 text-foreground-muted" />
                  <span className="font-medium">{step.name}</span>
                  <span className="text-xs text-foreground-muted">{index === 0 ? "on launch" : `+${step.delayDays}d${step.condition === "NO_REPLY" ? " if no reply" : ""}`}</span>
                  {step.useAI && (step.channel === "EMAIL" || step.channel === "WHATSAPP") ? <Sparkles className="size-3 text-accent" /> : null}
                </li>
              ))}
            </ol>
          </ReviewRow>
        </dl>
      </Section>
      <div className="grid content-start gap-3">
        {simulated.length ? (
          <Callout tone="warning" icon={AlertTriangle} title="Demo providers">
            {simulated.map((channel) => CHANNEL_LABELS[channel]).join(" and ")} will run through simulated providers. Nothing reaches real inboxes; opens and replies are simulated and labelled.
          </Callout>
        ) : null}
        {whatsappWithoutTemplate ? (
          <Callout tone="warning" icon={AlertTriangle}>
            {whatsappWithoutTemplate} WhatsApp step{whatsappWithoutTemplate === 1 ? " has" : "s have"} no approved template and will only send within a 24-hour reply window.
          </Callout>
        ) : null}
        <Callout tone="neutral" icon={Users}>
          Leads are checked against do-not-contact and suppression lists again right before every send.
        </Callout>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Wizard

function validate(step: number, state: BuilderState, preview: AudiencePreview | undefined): string | null {
  if (step === 0) {
    if (state.name.trim().length < 2) return "Give the campaign a name";
  }
  if (step === 1 && preview && preview.matched === 0) return "No leads match this audience";
  if (step === 2 && !state.channels.length) return "Pick at least one channel";
  if (step === 3) {
    if (!state.steps.length) return "Add at least one step";
    const emailWithoutSubject = state.steps.find((item) => item.channel === "EMAIL" && !item.subject?.trim());
    if (emailWithoutSubject) return `“${emailWithoutSubject.name}” needs a subject line`;
    const empty = state.steps.find((item) => !item.body.trim());
    if (empty) return `“${empty.name}” is empty`;
    const foreign = state.steps.find((item) => !state.channels.includes(item.channel));
    if (foreign) return `“${foreign.name}” uses ${CHANNEL_LABELS[foreign.channel]}, which isn’t selected`;
  }
  return null;
}

export function CampaignBuilder({ options }: { options: BuilderOptions }) {
  const router = useRouter();
  const initialChannels: Channel[] = options.providers.EMAIL.ok && options.plan.channels.includes("EMAIL") ? ["EMAIL"] : [];
  const [current, setCurrent] = React.useState(0);
  const [state, setState] = React.useState<BuilderState>(() => ({
    name: "",
    description: "",
    offeringIds: [],
    offerSummary: "",
    pitchAngle: "",
    tone: options.defaultTone,
    audience: { categories: [], cities: [], minScore: 60, statuses: ["NEW", "QUALIFIED"], qualifiedOnly: false },
    channels: initialChannels,
    automationMode: options.plan.automationModes.includes("ASSISTED") ? "ASSISTED" : "MANUAL",
    dailyLimits: {},
    steps: withKeys(defaultSequence(initialChannels.length ? initialChannels : ["EMAIL"])),
  }));
  const update = React.useCallback((patch: Partial<BuilderState>) => setState((previous) => ({ ...previous, ...patch })), []);
  const preview = useAudiencePreview(state.audience, state.channels);

  const create = useMutation({
    mutationFn: async () => {
      const campaign = await api<{ id: string }>("/api/v1/campaigns", {
        method: "POST",
        json: {
          name: state.name.trim(),
          description: state.description.trim() || null,
          automationMode: state.automationMode,
          target: {
            categories: state.audience.categories,
            locations: state.audience.cities.map((city) => ({ label: city, city })),
          },
          offeringIds: state.offeringIds,
          offerSummary: state.offerSummary.trim() || null,
          pitchAngle: state.pitchAngle.trim() || null,
          tone: state.tone,
          channels: state.channels,
          dailyLimits: Object.fromEntries(state.channels.map((channel) => [channel, state.dailyLimits[channel] ?? DEFAULT_DAILY_LIMITS[channel]])),
          minLeadScore: state.audience.minScore,
          steps: state.steps.map(({ key: _key, ...step }) => ({ ...step, subject: step.channel === "EMAIL" ? step.subject : null, whatsappTemplateId: step.channel === "WHATSAPP" ? step.whatsappTemplateId : null })),
        },
      });
      const added = await api<{ added: number; skipped: unknown[] }>(`/api/v1/campaigns/${campaign.id}/leads`, { method: "POST", json: { filters: preview.filters } });
      return { id: campaign.id, added: added.added };
    },
    onSuccess: ({ id, added }) => {
      toast.success(`Campaign created with ${added} lead${added === 1 ? "" : "s"}`);
      router.push(`/app/campaigns/${id}?launch=1`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const error = validate(current, state, preview.data);
  const last = current === STEPS.length - 1;
  const next = () => {
    if (error) return toast.error(error);
    if (last) create.mutate();
    else setCurrent(current + 1);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Campaign builder steps" className="lg:sticky lg:top-4 lg:self-start">
        <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
          {STEPS.map((step, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => index < current && setCurrent(index)}
                  disabled={index > current}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                    active ? "bg-surface shadow-xs ring-1 ring-border" : done ? "hover:bg-surface-muted" : "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular",
                      done ? "border-foreground bg-foreground text-background" : active ? "border-foreground" : "border-border-strong text-foreground-muted",
                    )}
                  >
                    {done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium whitespace-nowrap">{step.label}</span>
                    <span className="hidden text-[11px] text-foreground-muted lg:block">{step.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0">
        {current === 0 ? <OfferStep state={state} update={update} options={options} /> : null}
        {current === 1 ? <AudienceStep state={state} update={update} options={options} preview={preview} /> : null}
        {current === 2 ? <ChannelsStep state={state} update={update} options={options} /> : null}
        {current === 3 ? <SequenceStep state={state} update={update} options={options} sample={preview.data?.sample ?? []} /> : null}
        {current === 4 ? <ReviewStep state={state} options={options} preview={preview.data} /> : null}

        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 border-t border-border bg-background/90 py-3 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={() => (current === 0 ? router.push("/app/campaigns") : setCurrent(current - 1))}>
            <ArrowLeft /> {current === 0 ? "Cancel" : "Back"}
          </Button>
          <div className="flex items-center gap-3">
            {error && current !== 1 ? <span className="hidden text-xs text-foreground-muted sm:inline">{error}</span> : null}
            {current === 1 && preview.data ? (
              <span className="hidden text-xs text-foreground-muted sm:inline">
                {formatNumber(Math.min(preview.data.matched, preview.data.total))} leads selected
              </span>
            ) : null}
            <Button variant="primary" size="sm" onClick={next} disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <RefreshCw className="animate-spin" /> Creating…
                </>
              ) : last ? (
                <>
                  Create campaign <ArrowRight />
                </>
              ) : (
                <>
                  Continue <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
