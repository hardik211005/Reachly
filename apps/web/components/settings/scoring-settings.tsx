"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Gauge, ListPlus, RefreshCw, RotateCcw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { AnimatedNumber, Badge, Button, Callout, ErrorState, GrowBar, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, Switch, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { ReadOnlyNotice, Row, SaveBar, Section } from "./kit";

type ChainPolicy = "prefer" | "neutral" | "avoid" | "exclude";
type Factor = "icpMatch" | "industryMatch" | "locationMatch" | "sizeFit" | "contactability" | "digitalPresence" | "buyingSignals";

interface Rule {
  field: "category" | "city" | "locality" | "industry" | "reviewCount" | "rating" | "locationsCount" | "hasWebsite" | "hasEmail" | "hasPhone" | "signal";
  operator: "eq" | "neq" | "gte" | "lte" | "contains" | "exists" | "not_exists";
  value: string | number | boolean | null;
  points: number;
  label: string;
}

interface ModelView {
  trainedAt: string;
  metrics: { samples: number; positives: number; baseRate: number; auc: number | null; folds: number };
  suggestedWeights: Record<Factor, number>;
  reliable: boolean;
  importance: Array<{ factor: Factor; label: string; coefficient: number; suggestedWeight: number }>;
}

interface Settings {
  weights: Record<Factor, number>;
  defaults: Record<Factor, number>;
  factors: Array<{ factor: Factor; label: string; description: string }>;
  rules: Rule[];
  qualifiedThreshold: number;
  highFitThreshold: number;
  useAI: boolean;
  chainPolicy: ChainPolicy;
  chainPolicies: Array<{ value: ChainPolicy; label: string; description: string }>;
  chainLeads: number;
  version: number;
  model: ModelView | null;
  trainingSet: { samples: number; positives: number; negatives: number };
}

type TrainResponse = {
  result: { status: "trained"; metrics: ModelView["metrics"] } | { status: "insufficient_data"; samples: number; positives: number; negatives: number; needed: { samples: number; perClass: number } };
  settings: Settings;
};

const FIELDS: Array<{ value: Rule["field"]; label: string; kind: "text" | "number" | "flag" | "signal" }> = [
  { value: "category", label: "Category", kind: "text" },
  { value: "industry", label: "Industry", kind: "text" },
  { value: "city", label: "City", kind: "text" },
  { value: "locality", label: "Locality", kind: "text" },
  { value: "reviewCount", label: "Review count", kind: "number" },
  { value: "rating", label: "Rating", kind: "number" },
  { value: "locationsCount", label: "Locations", kind: "number" },
  { value: "hasWebsite", label: "Has website", kind: "flag" },
  { value: "hasEmail", label: "Has email", kind: "flag" },
  { value: "hasPhone", label: "Has phone", kind: "flag" },
  { value: "signal", label: "Buying signal", kind: "signal" },
];
const OPERATORS: Record<"text" | "number" | "flag" | "signal", Array<{ value: Rule["operator"]; label: string }>> = {
  text: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
    { value: "contains", label: "contains" },
  ],
  number: [
    { value: "gte", label: "at least" },
    { value: "lte", label: "at most" },
    { value: "eq", label: "equals" },
  ],
  flag: [
    { value: "exists", label: "yes" },
    { value: "not_exists", label: "no" },
  ],
  signal: [
    { value: "exists", label: "found" },
    { value: "not_exists", label: "not found" },
  ],
};
const fieldKind = (field: Rule["field"]) => FIELDS.find((item) => item.value === field)?.kind ?? "text";

function useSettingsMutation<T>(fn: () => Promise<T>, onDone: (data: T) => void) {
  return useMutation({ mutationFn: fn, onSuccess: onDone, onError: (error) => toast.error(errorMessage(error)) });
}

// ----------------------------------------------------------------------------- Weights & thresholds

function WeightsSection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const initial = { weights: settings.weights, qualifiedThreshold: settings.qualifiedThreshold, highFitThreshold: settings.highFitThreshold, useAI: settings.useAI, chainPolicy: settings.chainPolicy, rules: settings.rules };
  const [form, setForm] = React.useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const total = Object.values(form.weights).reduce((sum, value) => sum + value, 0) || 1;
  const invalid = total <= 0 || form.highFitThreshold < form.qualifiedThreshold || form.rules.some((rule) => !rule.label.trim());

  const save = useSettingsMutation(
    () => api<Settings>("/api/v1/scoring", { method: "PUT", json: form }),
    (updated) => {
      queryClient.setQueryData(["scoring"], updated);
      toast.success("Scoring saved", { description: "New scores use these settings. Re-score existing leads to update them." });
    },
  );
  const setWeight = (factor: Factor, value: number) => setForm((current) => ({ ...current, weights: { ...current.weights, [factor]: value } }));
  const setRule = (index: number, patch: Partial<Rule>) => setForm((current) => ({ ...current, rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) }));
  const disabled = !canManage;

  return (
    <>
      <Section
        title="Factor weights"
        description="How much each factor counts towards a lead's 0–100 score. Weights are relative — the share column shows what each one is really worth."
        icon={Gauge}
        footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={invalid} /> : null}
      >
        {canManage ? null : <ReadOnlyNotice what="scoring" />}
        <div className="grid gap-4">
          {settings.factors.map(({ factor, label, description }) => {
            const value = form.weights[factor];
            const share = Math.round((value / total) * 100);
            return (
              <div key={factor} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`w-${factor}`} className="text-[13px] font-medium">
                    {label}
                  </label>
                  <span className="text-[12px] tabular-nums text-foreground-muted">
                    weight <span className="font-semibold text-foreground">{value}</span> · {share}% of score
                  </span>
                </div>
                <input id={`w-${factor}`} type="range" min={0} max={50} step={1} value={value} disabled={disabled} onChange={(event) => setWeight(factor, Number(event.target.value))} className="w-full accent-[var(--foreground)] disabled:opacity-50" aria-describedby={`w-${factor}-hint`} />
                <p id={`w-${factor}-hint`} className="text-[11.5px] text-foreground-subtle">
                  {description}
                </p>
              </div>
            );
          })}
          {canManage ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setForm((current) => ({ ...current, weights: settings.defaults }))}>
                <RotateCcw /> Reset weights to defaults
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Thresholds and AI" description="Where a score becomes qualified or high-fit, and whether AI reviews each lead alongside the rules." icon={Sparkles} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={invalid} /> : null}>
        <Row label="Qualified at" hint="Leads at or above this score are qualified and move from New to Qualified. Up to 15 points below needs review." htmlFor="qualified">
          <Input id="qualified" type="number" min={1} max={100} className="w-28" value={form.qualifiedThreshold} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, qualifiedThreshold: Number(event.target.value) }))} />
        </Row>
        <Row label="High fit at" hint="Shown as High fit across leads, campaigns and analytics." htmlFor="highfit">
          <Input id="highfit" type="number" min={1} max={100} className="w-28" value={form.highFitThreshold} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, highFitThreshold: Number(event.target.value) }))} />
          {form.highFitThreshold < form.qualifiedThreshold ? <p className="mt-1.5 text-[12px] text-danger-text">Must be at or above the qualified threshold.</p> : null}
        </Row>
        <Row label="Chains & franchises" hint={`Outlets of brand chains usually have central marketing and buying. ${settings.chainLeads ? `${settings.chainLeads} of your leads are flagged as chains.` : "None of your leads are flagged as chains yet."} Re-score leads after changing this.`}>
          <Select value={form.chainPolicy} disabled={disabled} onValueChange={(value) => setForm((current) => ({ ...current, chainPolicy: value as ChainPolicy }))}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Chains and franchises">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {settings.chainPolicies.map((policy) => (
                <SelectItem key={policy.value} value={policy.value}>
                  {policy.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-[12px] text-foreground-muted">{settings.chainPolicies.find((policy) => policy.value === form.chainPolicy)?.description}</p>
        </Row>
        <Row label="AI qualification" hint="AI reads each lead against your offer and blends into ICP match and buying signals, with its reasons shown. Uses AI credits; failures fall back to rules.">
          <Switch checked={form.useAI} disabled={disabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, useAI: checked }))} aria-label="AI qualification" />
        </Row>
      </Section>

      <Section title="Custom rules" description="Add or subtract points when a lead matches a condition, after the weighted score. Every applied rule is listed in the lead's breakdown." icon={ListPlus} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={invalid} /> : null}>
        <div className="grid gap-3">
          {form.rules.length === 0 ? <p className="text-[13px] text-foreground-muted">No rules yet. Example: +10 when the lead has 3 or more locations.</p> : null}
          {form.rules.map((rule, index) => {
            const kind = fieldKind(rule.field);
            return (
              <div key={index} className="grid gap-2 rounded-lg border border-border bg-surface-muted/30 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_88px_32px] md:items-center">
                <Input aria-label="Rule label" placeholder="Label, e.g. Multi-location" value={rule.label} disabled={disabled} maxLength={80} onChange={(event) => setRule(index, { label: event.target.value })} />
                <Select
                  value={rule.field}
                  disabled={disabled}
                  onValueChange={(value) => {
                    const field = value as Rule["field"];
                    const next = fieldKind(field);
                    setRule(index, { field, operator: OPERATORS[next][0]!.value, value: next === "number" ? 0 : next === "flag" ? null : "" });
                  }}
                >
                  <SelectTrigger aria-label="Field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELDS.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={rule.operator} disabled={disabled} onValueChange={(value) => setRule(index, { operator: value as Rule["operator"] })}>
                  <SelectTrigger aria-label="Condition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS[kind].map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {kind === "flag" ? (
                  <span className="hidden md:block" />
                ) : (
                  <Input
                    aria-label="Value"
                    type={kind === "number" ? "number" : "text"}
                    placeholder={kind === "signal" ? "signal key, e.g. hiring" : "value"}
                    value={rule.value === null ? "" : String(rule.value)}
                    disabled={disabled}
                    onChange={(event) => setRule(index, { value: kind === "number" ? Number(event.target.value) : event.target.value })}
                  />
                )}
                <Input aria-label="Points" type="number" min={-50} max={50} value={rule.points} disabled={disabled} onChange={(event) => setRule(index, { points: Math.max(-50, Math.min(50, Math.round(Number(event.target.value)))) })} />
                {canManage ? (
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove rule ${rule.label || index + 1}`} onClick={() => setForm((current) => ({ ...current, rules: current.rules.filter((_, i) => i !== index) }))}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            );
          })}
          {canManage && form.rules.length < 30 ? (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, rules: [...current.rules, { field: "locationsCount", operator: "gte", value: 3, points: 10, label: "" }] }))}>
                <ListPlus /> Add rule
              </Button>
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}

// ----------------------------------------------------------------------------- Learned model

function ImportanceBars({ model, current }: { model: ModelView; current: Record<Factor, number> }) {
  const max = Math.max(0.01, ...model.importance.map((item) => Math.abs(item.coefficient)));
  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_84px] gap-3 text-[11px] font-medium text-foreground-subtle">
        <span>Factor</span>
        <span>Effect on conversion</span>
        <span className="text-right">Weight now → suggested</span>
      </div>
      {model.importance.map((item) => {
        const positive = item.coefficient >= 0;
        const width = (Math.abs(item.coefficient) / max) * 50;
        return (
          <div key={item.factor} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_84px] items-center gap-3">
            <span className="truncate text-[13px]">{item.label}</span>
            <div className="relative h-2.5 rounded-full bg-surface-muted" title={`Coefficient ${item.coefficient.toFixed(2)} per standard deviation`}>
              <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" aria-hidden />
              <div className={cn("absolute inset-y-0", positive ? "left-1/2" : "right-1/2")} style={{ width: `${width}%` }}>
                <GrowBar value={100} className="h-full rounded-full" barClassName={cn("rounded-full", positive ? "bg-success" : "bg-danger")} />
              </div>
            </div>
            <span className="text-right text-[12px] tabular-nums text-foreground-muted">
              {current[item.factor]} → <span className={cn("font-semibold", item.suggestedWeight > current[item.factor] ? "text-success-text" : item.suggestedWeight < current[item.factor] ? "text-warning-text" : "text-foreground")}>{item.suggestedWeight}</span>
            </span>
          </div>
        );
      })}
      <p className="text-[11.5px] text-foreground-subtle">Green pushes conversion up, red pulls it down. Suggested weights keep a small floor for every factor so no signal is dropped on thin evidence.</p>
    </div>
  );
}

function Readiness({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-foreground-secondary">{label}</span>
        <span className="tabular-nums text-foreground-muted">
          {value} / {target}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-muted">
        <GrowBar value={100} className="h-full rounded-full" style={{ width: `${pct}%` }} barClassName={cn("rounded-full", pct >= 100 ? "bg-success" : "bg-brand-1")} />
      </div>
    </div>
  );
}

function LearnedModelSection({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const { model, trainingSet } = settings;
  const [lastAttempt, setLastAttempt] = React.useState<TrainResponse["result"] | null>(null);

  const train = useSettingsMutation(
    () => api<TrainResponse>("/api/v1/scoring/model", { method: "POST", json: { action: "train" } }),
    (data) => {
      queryClient.setQueryData(["scoring"], data.settings);
      setLastAttempt(data.result);
      if (data.result.status === "trained") toast.success("Model trained", { description: `Learned from ${data.result.metrics.samples} contacted leads.` });
      else toast.message("Not enough outcomes yet", { description: "Keep running campaigns — the model trains once there are enough results." });
    },
  );
  const apply = useSettingsMutation(
    () => api<Settings>("/api/v1/scoring/model", { method: "POST", json: { action: "apply_weights" } }),
    (updated) => {
      queryClient.setQueryData(["scoring"], updated);
      toast.success("Suggested weights applied", { description: "Re-score your leads to see the effect." });
    },
  );
  const clear = useSettingsMutation(
    () => api<Settings>("/api/v1/scoring/model", { method: "DELETE" }),
    (updated) => {
      queryClient.setQueryData(["scoring"], updated);
      toast.success("Model removed");
    },
  );

  const NEEDED = { samples: 30, perClass: 5 };
  const weightsMatch = model ? Object.entries(model.suggestedWeights).every(([factor, weight]) => settings.weights[factor as Factor] === weight) : false;

  return (
    <Section
      title="Learn from your results"
      description="A small machine-learning model trained on your own outcomes: which leads, once contacted, became interested, booked a meeting, got a quote or were won. It shows what really predicts conversion and suggests weights — it never changes your scoring on its own."
      icon={BrainCircuit}
      footer={
        <>
          {model && canManage ? (
            <Button variant="ghost" size="sm" className="mr-auto" disabled={clear.isPending} onClick={() => clear.mutate()}>
              Remove model
            </Button>
          ) : null}
          <Button variant={model ? "secondary" : "primary"} size="sm" disabled={train.isPending} onClick={() => train.mutate()}>
            {train.isPending ? <Spinner className="size-3.5" /> : <RefreshCw />} {model ? "Retrain now" : "Train model"}
          </Button>
          {model && canManage ? (
            <Button variant="primary" size="sm" disabled={apply.isPending || weightsMatch} onClick={() => apply.mutate()}>
              {apply.isPending ? <Spinner className="size-3.5" /> : <Wand2 />} {weightsMatch ? "Suggested weights in use" : "Apply suggested weights"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Contacted leads with an outcome", value: trainingSet.samples },
            { label: "Converted", value: trainingSet.positives },
            { label: "Not converted", value: trainingSet.negatives },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5">
              <p className="font-heading text-xl font-semibold tabular-nums">
                <AnimatedNumber value={stat.value} />
              </p>
              <p className="text-[11.5px] leading-snug text-foreground-muted">{stat.label}</p>
            </div>
          ))}
        </div>

        {model ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Badge tone={model.reliable ? "success" : "warning"}>{model.reliable ? "Reliable signal" : "Weak signal"}</Badge>
              <span className="text-foreground-secondary">
                Cross-validated AUC <span className="font-semibold tabular-nums text-foreground">{model.metrics.auc?.toFixed(2) ?? "–"}</span>
              </span>
              <span className="text-foreground-subtle">·</span>
              <span className="text-foreground-secondary">{model.metrics.samples} leads, {Math.round(model.metrics.baseRate * 100)}% converted</span>
              <span className="text-foreground-subtle">·</span>
              <span className="text-foreground-muted">trained {new Date(model.trainedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
            </div>
            {!model.reliable ? (
              <Callout tone="warning" title="Treat these suggestions with caution">
                The model ranks leads only a little better than chance (AUC below 0.60) on leads it did not train on. More outcomes usually help; retraining runs automatically every week.
              </Callout>
            ) : null}
            <ImportanceBars model={model} current={settings.weights} />
          </>
        ) : (
          <div className="grid gap-3">
            <p className="text-[13px] text-foreground-secondary">The model needs enough contacted leads with a result. Leads contacted in the last 7 days wait until they have had a fair chance to reply.</p>
            <Readiness label="Leads with an outcome" value={trainingSet.samples} target={NEEDED.samples} />
            <Readiness label="Converted" value={trainingSet.positives} target={NEEDED.perClass} />
            <Readiness label="Not converted" value={trainingSet.negatives} target={NEEDED.perClass} />
            {lastAttempt?.status === "insufficient_data" ? <p className="text-[12px] text-foreground-muted">Last attempt: {lastAttempt.samples} usable leads. Keep running campaigns and try again.</p> : null}
          </div>
        )}
        <p className="text-[11.5px] text-foreground-subtle">
          Method: logistic regression with L2 regularisation and class balancing on the seven factor scores, evaluated with stratified {model?.metrics.folds ?? 5}-fold cross-validation. Each lead page then shows its predicted chance of converting and what drives it.
        </p>
      </div>
    </Section>
  );
}

function RescoreSection() {
  const canManage = useCanManage();
  const rescore = useSettingsMutation(
    () => api<{ queued: number; chains: number }>("/api/v1/scoring/rescore", { method: "POST" }),
    (data) => toast.success(`Re-scoring ${data.queued.toLocaleString()} leads`, { description: `${data.chains} chain or franchise outlets flagged. Scores update in the background over the next few minutes.` }),
  );
  if (!canManage) return null;
  return (
    <Section title="Re-score leads" description="Apply the current weights, rules, thresholds and chain policy to every lead, and re-check which leads are chains. With AI qualification on, each lead uses AI credits." icon={RefreshCw}>
      <Button variant="secondary" size="sm" disabled={rescore.isPending} onClick={() => rescore.mutate()}>
        {rescore.isPending ? <Spinner className="size-3.5" /> : <RefreshCw />} Re-score all leads
      </Button>
    </Section>
  );
}

export function ScoringSettings() {
  const settings = useQuery({ queryKey: ["scoring"], queryFn: () => api<Settings>("/api/v1/scoring") });
  if (settings.isError) return <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <>
      <Callout tone="accent" icon={Gauge} title="Transparent by design">
        Every score is a weighted sum of seven factors plus your rules, and each lead shows the reasons behind every point.
      </Callout>
      <WeightsSection key={settings.data.version} settings={settings.data} />
      <LearnedModelSection settings={settings.data} />
      <RescoreSection />
    </>
  );
}
