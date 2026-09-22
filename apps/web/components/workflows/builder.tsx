"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Braces,
  CircleAlert,
  CircleCheck,
  Copy,
  FlaskConical,
  History,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { DEAL_STAGE_LABELS, DEAL_STAGES, LEAD_STATUS_LABELS, LEAD_STATUSES, type LeadStatus } from "@repo/config";
import {
  CONDITION_FIELDS,
  EVENT_TRIGGER_META,
  STEP_CATALOG,
  TEMPLATE_FIELDS,
  WORKFLOW_EVENT_TRIGGERS,
  validateDefinition,
  workflowInputSchema,
  type StepCategory,
  type WorkflowCondition,
  type WorkflowDefinition,
  type WorkflowIssue,
  type WorkflowStep,
  type WorkflowStepType,
  type WorkflowTrigger,
} from "@repo/core/workflows/schemas";
import {
  Badge,
  Button,
  Callout,
  CompanyMark,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  Tooltip,
  cn,
  toast,
} from "@repo/ui";
import { api, apiWithMeta, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { OUTCOME_COLOR, OUTCOME_ICON, RunSheet, outcomeText, type ExecutionDetail } from "./run-detail";
import { RunStatusBadge, StepGlyph, TRIGGER_ICONS, conditionText, defaultStep, runDuration, stepSummary, triggerDetail, triggerTitle } from "./shared";

// ----------------------------------------------------------------------------- Types

export interface BuilderWorkflow {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  version: number;
  runCount: number;
  lastRunAt: string | null;
  issues: WorkflowIssue[];
  hookUrl: string | null;
  signingSecret: string | null;
}

export interface BuilderOptions {
  campaigns: Array<{ id: string; name: string; status: string }>;
  n8nAllowed: boolean;
  n8nMode: "connected" | "platform" | "mock" | "not_configured";
  callingReady: boolean;
}

type Draft = Pick<BuilderWorkflow, "name" | "description" | "trigger" | "steps">;
type Selection = "trigger" | string | null;

const CATEGORY_LABELS: Record<StepCategory, string> = { logic: "Logic", lead: "Lead", outreach: "Outreach", team: "Team", integrations: "Integrations" };
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN_LABELS = new Map<string, string>(TEMPLATE_FIELDS.map((field) => [field.key, field.label]));

/** "{{lead.name}}" → "Lead name"; unknown tokens show their path. */
function tokenLabel(token: string) {
  const key = token.replace(/[{}\s]/g, "");
  return TOKEN_LABELS.get(key) ?? key;
}

function snapshot(draft: Draft): string {
  return JSON.stringify(draft);
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input readOnly value={value} aria-label={label} className="h-8 font-mono text-[11px]" onFocus={(event) => event.target.select()} />
      <Tooltip content="Copy">
        <Button size="icon-sm" variant="secondary" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copied"))}>
          <Copy />
        </Button>
      </Tooltip>
    </div>
  );
}

// ----------------------------------------------------------------------------- Inputs

function VariableMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost" className="text-foreground-muted">
          <Braces /> Insert
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {TEMPLATE_FIELDS.map((field) => (
          <DropdownMenuItem key={field.key} onSelect={() => onInsert(`{{${field.key}}}`)}>
            <span className="flex-1">{field.label}</span>
            <span className="font-mono text-[10.5px] text-foreground-muted">{field.key}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplatedField({ label, value, onChange, multiline = false, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string; hint?: string }) {
  const id = React.useId();
  return (
    <Field>
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <VariableMenu onInsert={(token) => onChange(`${value}${value && !value.endsWith(" ") ? " " : ""}${token}`)} />
      </div>
      {multiline ? (
        <Textarea id={id} rows={5} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      ) : (
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      )}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </Field>
  );
}

const OPS_BY_KIND: Record<string, Array<{ op: WorkflowCondition["op"]; label: string }>> = {
  number: [
    { op: "gte", label: "is at least" },
    { op: "gt", label: "is more than" },
    { op: "lte", label: "is at most" },
    { op: "lt", label: "is less than" },
    { op: "equals", label: "equals" },
  ],
  enum: [
    { op: "in", label: "is any of" },
    { op: "not_in", label: "is none of" },
  ],
  text: [
    { op: "equals", label: "is" },
    { op: "not_equals", label: "is not" },
    { op: "contains", label: "contains" },
    { op: "exists", label: "is set" },
    { op: "not_exists", label: "is empty" },
  ],
  list: [
    { op: "contains", label: "includes" },
    { op: "exists", label: "has any" },
    { op: "not_exists", label: "has none" },
  ],
};

function optionLabel(field: string, option: string): string {
  if (field.endsWith("status") || field.endsWith(".to")) return LEAD_STATUS_LABELS[option as LeadStatus] ?? option;
  return option.charAt(0) + option.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Enum fields are edited as lists, so "equals X" (e.g. from the API or a template) shows as "is any of [X]". */
function editable(condition: WorkflowCondition): WorkflowCondition {
  if (CONDITION_FIELDS.find((field) => field.field === condition.field)?.kind !== "enum") return condition;
  const op = condition.op === "equals" ? "in" : condition.op === "not_equals" ? "not_in" : condition.op;
  const value = Array.isArray(condition.value) ? condition.value : condition.value === null || condition.value === "" ? [] : [String(condition.value)];
  return { ...condition, op, value };
}

function ConditionEditor({ conditions, onChange, emptyText }: { conditions: WorkflowCondition[]; onChange: (conditions: WorkflowCondition[]) => void; emptyText?: string }) {
  const update = (index: number, patch: Partial<WorkflowCondition>) => onChange(conditions.map((condition, i) => (i === index ? { ...editable(condition), ...patch } : condition)));
  return (
    <div className="grid gap-2">
      {conditions.length === 0 && emptyText ? <p className="text-xs text-foreground-muted">{emptyText}</p> : null}
      {conditions.map((raw, index) => {
        const condition = editable(raw);
        const meta = CONDITION_FIELDS.find((field) => field.field === condition.field) ?? CONDITION_FIELDS[0]!;
        const ops = OPS_BY_KIND[meta.kind] ?? OPS_BY_KIND.text!;
        const selected = Array.isArray(condition.value) ? condition.value : [];
        return (
          <div key={index} className="grid gap-2 rounded-md border border-border bg-surface-muted/40 p-2.5">
            <div className="flex items-center gap-1.5">
              <Select
                value={condition.field}
                onValueChange={(field) => {
                  const kind = CONDITION_FIELDS.find((item) => item.field === field)?.kind ?? "text";
                  const op = (OPS_BY_KIND[kind] ?? OPS_BY_KIND.text!)[0]!.op;
                  update(index, { field, op, value: kind === "enum" ? [] : kind === "number" ? 0 : "" });
                }}
              >
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_FIELDS.map((field) => (
                    <SelectItem key={field.field} value={field.field}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={condition.op} onValueChange={(op) => update(index, { op: op as WorkflowCondition["op"] })}>
                <SelectTrigger className="h-8 w-32 text-xs" aria-label="Operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ops.map((item) => (
                    <SelectItem key={item.op} value={item.op}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="icon-xs" variant="ghost" aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, i) => i !== index))}>
                <X />
              </Button>
            </div>
            {condition.op === "exists" || condition.op === "not_exists" ? null : meta.kind === "enum" ? (
              <div className="flex flex-wrap gap-1">
                {(meta.options ?? []).map((option) => {
                  const active = selected.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update(index, { value: active ? selected.filter((item) => item !== option) : [...selected, option] })}
                      className={cn("h-6 rounded-full border px-2 text-[11px] font-medium transition-colors", active ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground-secondary hover:border-border-strong")}
                    >
                      {optionLabel(condition.field, option)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Input
                className="h-8 text-xs"
                type={meta.kind === "number" ? "number" : "text"}
                value={condition.value === null || Array.isArray(condition.value) ? "" : String(condition.value)}
                onChange={(event) => update(index, { value: meta.kind === "number" ? Number(event.target.value) : event.target.value })}
                aria-label="Value"
              />
            )}
          </div>
        );
      })}
      <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => onChange([...conditions, { field: "lead.score", op: "gte", value: 70 }])}>
        <Plus /> Add condition
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------------------- Inspector

function TriggerInspector({ trigger, onChange, hookUrl }: { trigger: WorkflowTrigger; onChange: (trigger: WorkflowTrigger) => void; hookUrl: string | null }) {
  return (
    <div className="grid gap-4">
      <SegmentedControl
        size="sm"
        value={trigger.type}
        onValueChange={(type) =>
          onChange(
            type === "event"
              ? { type, eventType: "reply_classified", conditions: [] }
              : type === "schedule"
                ? { type, frequency: "daily", hour: 9, weekday: 1 }
                : { type },
          )
        }
        options={[
          { value: "event", label: "Event" },
          { value: "schedule", label: "Schedule" },
          { value: "webhook", label: "Webhook" },
          { value: "manual", label: "Manual" },
        ]}
      />
      {trigger.type === "event" ? (
        <>
          <Field>
            <Label>When this happens</Label>
            <Select value={trigger.eventType} onValueChange={(eventType) => onChange({ ...trigger, eventType: eventType as typeof trigger.eventType })}>
              <SelectTrigger aria-label="Event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_EVENT_TRIGGERS.map((event) => (
                  <SelectItem key={event} value={event}>
                    {EVENT_TRIGGER_META[event].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint>{EVENT_TRIGGER_META[trigger.eventType].description}</FieldHint>
          </Field>
          <div className="grid gap-1.5">
            <Label>Only if (optional)</Label>
            <ConditionEditor conditions={trigger.conditions} onChange={(conditions) => onChange({ ...trigger, conditions })} emptyText="Runs for every matching event." />
          </div>
        </>
      ) : null}
      {trigger.type === "schedule" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <Label>Frequency</Label>
            <Select value={trigger.frequency} onValueChange={(frequency) => onChange({ ...trigger, frequency: frequency as "daily" | "weekly" })}>
              <SelectTrigger aria-label="Frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Every day</SelectItem>
                <SelectItem value="weekly">Every week</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label>At</Label>
            <Select value={String(trigger.hour)} onValueChange={(hour) => onChange({ ...trigger, hour: Number(hour) })}>
              <SelectTrigger aria-label="Hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {String(hour).padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {trigger.frequency === "weekly" ? (
            <Field className="sm:col-span-2">
              <Label>On</Label>
              <Select value={String(trigger.weekday)} onValueChange={(weekday) => onChange({ ...trigger, weekday: Number(weekday) })}>
                <SelectTrigger aria-label="Weekday">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <p className="text-xs text-foreground-muted sm:col-span-2">Scheduled runs have no lead, so lead steps aren’t available. Use them for digests, n8n syncs or team reminders.</p>
        </div>
      ) : null}
      {trigger.type === "webhook" ? (
        <div className="grid gap-2">
          <Label>Trigger URL</Label>
          {hookUrl ? <CopyField value={hookUrl} label="trigger URL" /> : <p className="text-xs text-foreground-muted">Save the workflow to get its URL.</p>}
          <p className="text-xs leading-relaxed text-foreground-muted">
            POST JSON to this URL from n8n or any system. Include <code className="font-mono">leadId</code> to run lead steps, and an optional <code className="font-mono">idempotencyKey</code> so retries don’t start twice. The URL itself is the credential — keep it secret.
          </p>
        </div>
      ) : null}
      {trigger.type === "manual" ? <p className="text-xs leading-relaxed text-foreground-muted">Runs when someone clicks “Run” here, optionally for a lead you choose.</p> : null}
    </div>
  );
}

function StepInspector({ step, onChange, options, signingSecret }: { step: WorkflowStep; onChange: (step: WorkflowStep) => void; options: BuilderOptions; signingSecret: string | null }) {
  switch (step.type) {
    case "condition":
      return (
        <div className="grid gap-3">
          <Field>
            <Label>Continue when</Label>
            <SegmentedControl
              size="sm"
              value={step.match}
              onValueChange={(match) => onChange({ ...step, match })}
              options={[
                { value: "all", label: "All match" },
                { value: "any", label: "Any matches" },
              ]}
            />
          </Field>
          <ConditionEditor conditions={step.conditions} onChange={(conditions) => onChange({ ...step, conditions })} />
          <p className="text-xs text-foreground-muted">If the conditions don’t match, the run stops here (it’s not an error).</p>
        </div>
      );
    case "delay":
      return (
        <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
          <Field>
            <Label htmlFor="delay-amount">Wait</Label>
            <Input id="delay-amount" type="number" min={1} max={90} value={step.amount} onChange={(event) => onChange({ ...step, amount: Math.max(1, Math.min(90, Number(event.target.value) || 1)) })} />
          </Field>
          <Field>
            <Label>Unit</Label>
            <Select value={step.unit} onValueChange={(unit) => onChange({ ...step, unit: unit as typeof step.unit })}>
              <SelectTrigger aria-label="Unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      );
    case "update_lead_status":
      return (
        <Field>
          <Label>New status</Label>
          <Select value={step.status} onValueChange={(status) => onChange({ ...step, status: status as typeof step.status })}>
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.filter((status) => status !== "DO_NOT_CONTACT").map((status) => (
                <SelectItem key={status} value={status}>
                  {LEAD_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldHint>Do-not-contact leads are never changed by workflows.</FieldHint>
        </Field>
      );
    case "move_deal":
      return (
        <Field>
          <Label>Stage</Label>
          <Select value={step.stage} onValueChange={(stage) => onChange({ ...step, stage: stage as typeof step.stage })}>
            <SelectTrigger aria-label="Deal stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.filter((stage) => stage !== "NEW" && stage !== "LOST").map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {DEAL_STAGE_LABELS[stage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldHint>Opens a deal if the lead has none. A deal already further along stays where it is.</FieldHint>
        </Field>
      );
    case "add_tag":
      return <TemplatedField label="Tag" value={step.tag} onChange={(tag) => onChange({ ...step, tag })} placeholder="hot" />;
    case "create_task":
      return (
        <div className="grid gap-3">
          <TemplatedField label="Task" value={step.title} onChange={(title) => onChange({ ...step, title })} />
          <div className="grid grid-cols-3 gap-2">
            <Field>
              <Label>Type</Label>
              <Select value={step.taskType} onValueChange={(taskType) => onChange({ ...step, taskType: taskType as typeof step.taskType })}>
                <SelectTrigger aria-label="Task type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["TODO", "CALL", "EMAIL", "FOLLOW_UP", "MEETING"].map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0) + type.slice(1).toLowerCase().replace("_", "-")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label>Priority</Label>
              <Select value={step.priority} onValueChange={(priority) => onChange({ ...step, priority: priority as typeof step.priority })}>
                <SelectTrigger aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="task-due">Due in days</Label>
              <Input id="task-due" type="number" min={0} max={90} value={step.dueInDays} onChange={(event) => onChange({ ...step, dueInDays: Math.max(0, Math.min(90, Number(event.target.value) || 0)) })} />
            </Field>
          </div>
          <p className="text-xs text-foreground-muted">Assigned to the lead’s owner when there is one.</p>
        </div>
      );
    case "add_to_campaign":
      return (
        <Field>
          <Label>Campaign</Label>
          <Select value={options.campaigns.some((campaign) => campaign.id === step.campaignId) ? step.campaignId : undefined} onValueChange={(campaignId) => onChange({ ...step, campaignId })}>
            <SelectTrigger aria-label="Campaign">
              <SelectValue placeholder="Choose a campaign" />
            </SelectTrigger>
            <SelectContent>
              {options.campaigns
                .filter((campaign) => !["COMPLETED", "ARCHIVED"].includes(campaign.status))
                .map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldHint>Skipped automatically if the lead is do-not-contact, suppressed or already in another running campaign.</FieldHint>
        </Field>
      );
    case "stop_sequences":
      return <p className="text-[13px] text-foreground-secondary">Stops every running campaign sequence for the lead and cancels its queued follow-ups.</p>;
    case "notify":
      return (
        <div className="grid gap-3">
          <TemplatedField label="Title" value={step.title} onChange={(title) => onChange({ ...step, title })} />
          <TemplatedField label="Message" value={step.body} onChange={(body) => onChange({ ...step, body })} multiline />
          <p className="text-xs text-foreground-muted">Goes to everyone in the workspace, and to Slack when it’s connected.</p>
        </div>
      );
    case "send_email":
      return (
        <div className="grid gap-3">
          <TemplatedField label="Subject" value={step.subject} onChange={(subject) => onChange({ ...step, subject })} />
          <TemplatedField label="Body" value={step.body} onChange={(body) => onChange({ ...step, body })} multiline />
          <label className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <span>
              <span className="block text-[13px] font-medium">Wait for approval</span>
              <span className="block text-xs text-foreground-muted">On: the email waits as a draft in the review queue. Off: it’s sent right away (still subject to opt-outs and suppression).</span>
            </span>
            <Switch checked={step.requireApproval} onCheckedChange={(requireApproval) => onChange({ ...step, requireApproval })} />
          </label>
        </div>
      );
    case "prepare_call":
      return (
        <Field>
          <Label>Call type</Label>
          <SegmentedControl
            size="sm"
            value={step.callType}
            onValueChange={(callType) => onChange({ ...step, callType })}
            options={[
              { value: "MANUAL", label: "Manual" },
              { value: "AI_AGENT", label: "AI voice agent" },
            ]}
          />
          <FieldHint>
            The call waits in the Calls queue with an AI brief — someone still starts it.{step.callType === "AI_AGENT" && !options.callingReady ? " AI calling isn’t set up yet." : ""}
          </FieldHint>
        </Field>
      );
    case "webhook":
      return (
        <div className="grid gap-3">
          <Field>
            <Label htmlFor="webhook-url">URL</Label>
            <Input id="webhook-url" value={step.url} onChange={(event) => onChange({ ...step, url: event.target.value })} placeholder="https://" />
            <FieldHint>HTTPS to a public host. The request is POSTed as JSON.</FieldHint>
          </Field>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Include lead details
            <Switch checked={step.includeLead} onCheckedChange={(includeLead) => onChange({ ...step, includeLead })} />
          </label>
          <div className="grid gap-1.5">
            <Label>Signing secret</Label>
            {signingSecret ? <CopyField value={signingSecret} label="signing secret" /> : <p className="text-xs text-foreground-muted">Save to see the secret.</p>}
            <p className="text-xs text-foreground-muted">
              Verify <code className="font-mono">x-reachai-signature: t=…,v1=…</code> — HMAC-SHA256 of <code className="font-mono">t.body</code>.
            </p>
          </div>
        </div>
      );
    case "n8n":
      return (
        <div className="grid gap-3">
          {options.n8nMode === "not_configured" ? (
            <Callout tone="warning" icon={CircleAlert}>
              n8n isn’t connected. Set N8N_URL or connect it in Integrations.
            </Callout>
          ) : options.n8nMode === "mock" ? (
            <Callout tone="warning" icon={FlaskConical}>
              Demo mode — the n8n call is simulated until you connect an instance.
            </Callout>
          ) : null}
          <Field>
            <Label htmlFor="n8n-path">Webhook path</Label>
            <div className="flex items-center rounded-md border border-border bg-surface pl-2.5 focus-within:border-border-strong">
              <span className="font-mono text-xs text-foreground-muted">/webhook/</span>
              <Input id="n8n-path" value={step.webhookPath} onChange={(event) => onChange({ ...step, webhookPath: event.target.value.replace(/^\/+/, "") })} className="border-0 pl-0.5 font-mono text-xs shadow-none focus-visible:ring-0" />
            </div>
            <FieldHint>The Webhook node’s path in your n8n workflow (production URL).</FieldHint>
          </Field>
          <label className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <span>
              <span className="block text-[13px] font-medium">Wait for n8n to call back</span>
              <span className="block text-xs text-foreground-muted">The run pauses until n8n POSTs to the callback URL it receives; its data is available to later steps.</span>
            </span>
            <Switch checked={step.waitForCallback} onCheckedChange={(waitForCallback) => onChange({ ...step, waitForCallback })} />
          </label>
          {step.waitForCallback ? (
            <Field>
              <Label htmlFor="n8n-timeout">Give up after (hours)</Label>
              <Input id="n8n-timeout" type="number" min={1} max={72} value={step.timeoutHours} onChange={(event) => onChange({ ...step, timeoutHours: Math.max(1, Math.min(72, Number(event.target.value) || 1)) })} />
            </Field>
          ) : null}
        </div>
      );
  }
}

// ----------------------------------------------------------------------------- Canvas

function StepPicker({ onPick, triggerHasLead }: { onPick: (type: WorkflowStepType) => void; triggerHasLead: boolean }) {
  const [open, setOpen] = React.useState(false);
  const groups = (Object.keys(CATEGORY_LABELS) as StepCategory[]).map((category) => ({
    category,
    items: (Object.keys(STEP_CATALOG) as WorkflowStepType[]).filter((type) => STEP_CATALOG[type].category === category),
  }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a step"
          className="relative z-[1] flex size-6 items-center justify-center rounded-full border border-border-strong bg-surface text-foreground-muted shadow-xs transition-all hover:scale-110 hover:border-foreground hover:text-foreground data-[state=open]:border-foreground data-[state=open]:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-1.5" align="center">
        <div className="max-h-[420px] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.category} className="py-1">
              <p className="px-2 py-1 text-[10.5px] font-semibold tracking-wide text-foreground-subtle uppercase">{CATEGORY_LABELS[group.category]}</p>
              {group.items.map((type) => {
                const disabled = STEP_CATALOG[type].needsLead && !triggerHasLead;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onPick(type);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <StepGlyph type={type} className="size-7" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{STEP_CATALOG[type].label}</span>
                      <span className="block truncate text-[11px] text-foreground-muted">{disabled ? "Needs a trigger with a lead" : STEP_CATALOG[type].description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Connector({ onPick, triggerHasLead, editable }: { onPick: (type: WorkflowStepType) => void; triggerHasLead: boolean; editable: boolean }) {
  return (
    <div className="relative flex h-12 w-full items-center justify-center">
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-strong" />
      {editable ? <StepPicker onPick={onPick} triggerHasLead={triggerHasLead} /> : null}
    </div>
  );
}

function NodeCard({
  selected,
  onSelect,
  glyph,
  eyebrow,
  title,
  summary,
  issues,
  test,
}: {
  selected: boolean;
  onSelect: () => void;
  glyph: React.ReactNode;
  eyebrow: string;
  title: string;
  summary: string;
  issues: string[];
  test?: ReturnType<typeof outcomeText> | null;
}) {
  const TestIcon = test ? OUTCOME_ICON[test.tone] : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative w-full rounded-xl border bg-surface p-3.5 text-left shadow-xs transition-[border,box-shadow] duration-150",
        selected ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]" : issues.length ? "border-warning/60 hover:border-warning" : "border-border hover:border-border-strong hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-3">
        {glyph}
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold tracking-wide text-foreground-subtle uppercase">{eyebrow}</p>
          <p className="truncate text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-foreground-muted">
            {summary.split(/(\{\{\s*[\w.]+\s*\}\})/g).map((part, index) =>
              /^\{\{/.test(part) ? (
                <span key={index} className="rounded-[3px] bg-accent-soft px-1 text-[11px] font-medium text-accent-soft-foreground">
                  {tokenLabel(part)}
                </span>
              ) : (
                <React.Fragment key={index}>{part}</React.Fragment>
              ),
            )}
          </p>
        </div>
        {issues.length ? (
          <Tooltip content={issues.join(" · ")}>
            <span className="text-warning-text">
              <CircleAlert className="size-4" />
            </span>
          </Tooltip>
        ) : null}
      </div>
      {test && TestIcon ? (
        <p className={cn("mt-2.5 flex items-start gap-1.5 border-t border-border pt-2 text-[11.5px]", OUTCOME_COLOR[test.tone])}>
          <TestIcon className="mt-px size-3.5 shrink-0" /> <span className="line-clamp-2">{test.text}</span>
        </p>
      ) : null}
    </button>
  );
}

// ----------------------------------------------------------------------------- Test run

interface LeadOption {
  id: string;
  name: string;
  city: string | null;
  locality: string | null;
  status: string;
}

function TestDialog({ open, onOpenChange, needsLead, onRun, running }: { open: boolean; onOpenChange: (open: boolean) => void; needsLead: boolean; onRun: (leadId: string | null) => void; running: boolean }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [leadId, setLeadId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 200);
    return () => window.clearTimeout(timer);
  }, [q]);
  const leads = useQuery({
    queryKey: ["workflow-test-leads", debounced],
    queryFn: () => apiWithMeta<LeadOption[]>(`/api/v1/leads?pageSize=8&sort=lastActivityAt&order=desc${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    enabled: open && needsLead,
    placeholderData: (previous) => previous,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Test this workflow</DialogTitle>
          <DialogDescription>A dry run: every step reports what it would do, and nothing is changed, sent or created.</DialogDescription>
        </DialogHeader>
        {needsLead ? (
          <div className="grid gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-subtle" />
              <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Pick a lead to test with" className="pl-8" aria-label="Search leads" autoFocus />
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
                      aria-selected={leadId === lead.id}
                      onClick={() => setLeadId(lead.id)}
                      className={cn("flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left", leadId === lead.id ? "bg-accent-soft" : "hover:bg-surface-muted")}
                    >
                      <CompanyMark name={lead.name} className="size-6 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{lead.name}</span>
                        <span className="block truncate text-[11px] text-foreground-muted">{[LEAD_STATUS_LABELS[lead.status as LeadStatus], lead.locality, lead.city].filter(Boolean).join(" · ")}</span>
                      </span>
                      {leadId === lead.id ? <CircleCheck className="size-3.5 text-accent" /> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-foreground-muted">This trigger has no lead, so the test runs without one.</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={(needsLead && !leadId) || running} onClick={() => onRun(leadId)}>
            <FlaskConical /> {running ? "Testing…" : "Run test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Runs panel

interface RunRow {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lead: { id: string; name: string } | null;
}

function RunsPanel({ workflowId, onOpen }: { workflowId: string; onOpen: (id: string) => void }) {
  const runs = useQuery({ queryKey: ["workflow-runs", workflowId], queryFn: () => api<RunRow[]>(`/api/v1/workflows/executions?workflowId=${workflowId}&limit=25`), refetchInterval: 10_000 });
  if (runs.isPending) return <Skeleton className="h-40" />;
  if (!runs.data?.length) return <p className="py-6 text-center text-xs text-foreground-muted">No runs yet. Once active, every run appears here with each step’s result.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {runs.data.map((run) => (
        <li key={run.id}>
          <button type="button" onClick={() => onOpen(run.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-muted/60">
            <RunStatusBadge status={run.status} />
            <span className="min-w-0 flex-1 truncate text-xs">{run.lead?.name ?? `${run.triggerType} run`}</span>
            <span className="shrink-0 text-[11px] text-foreground-muted">
              {runDuration(run.startedAt, run.completedAt)} · <RelativeTime value={run.createdAt} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------------------- Builder

export function WorkflowBuilder({ initial, options }: { initial: BuilderWorkflow; options: BuilderOptions }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [workflow, setWorkflow] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>({ name: initial.name, description: initial.description, trigger: initial.trigger, steps: initial.steps });
  const [saved, setSaved] = React.useState(() => snapshot({ name: initial.name, description: initial.description, trigger: initial.trigger, steps: initial.steps }));
  const [selected, setSelected] = React.useState<Selection>("trigger");
  const [panel, setPanel] = React.useState<"inspector" | "runs">("inspector");
  const [testOpen, setTestOpen] = React.useState(false);
  const [test, setTest] = React.useState<ExecutionDetail | null>(null);
  const [runId, setRunId] = React.useState<string | null>(null);
  const dirty = snapshot(draft) !== saved;

  const triggerHasLead = draft.trigger.type === "event" ? EVENT_TRIGGER_META[draft.trigger.eventType].hasLead : draft.trigger.type !== "schedule";
  const parsed = workflowInputSchema.safeParse(draft);
  const issues = React.useMemo(() => {
    const list = validateDefinition(draft as WorkflowDefinition, { n8nAllowed: options.n8nAllowed, campaignIds: options.campaigns.map((campaign) => campaign.id) });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "steps" && typeof issue.path[1] === "number") list.push({ stepId: draft.steps[issue.path[1]]?.id ?? null, message: `${String(issue.path.at(-1))}: ${issue.message}` });
        else if (issue.path[0] === "name") list.push({ stepId: null, message: "Name the workflow (at least 2 characters)" });
        else if (issue.path[0] === "trigger") list.push({ stepId: "trigger", message: issue.message });
      }
    }
    return list;
  }, [draft, parsed, options.campaigns, options.n8nAllowed]);
  const issuesFor = (stepId: string) => issues.filter((issue) => issue.stepId === stepId).map((issue) => issue.message);

  const save = useMutation({
    mutationFn: (body: Draft) => api<BuilderWorkflow>(`/api/v1/workflows/${workflow.id}`, { method: "PUT", json: body }),
    onSuccess: (result, body) => {
      setWorkflow(result);
      setSaved(snapshot(body));
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const setStatus = useMutation({
    mutationFn: (status: "ACTIVE" | "PAUSED") => api<BuilderWorkflow>(`/api/v1/workflows/${workflow.id}/status`, { method: "POST", json: { status } }),
    onSuccess: (result) => {
      setWorkflow(result);
      toast.success(result.status === "ACTIVE" ? "Workflow is live" : "Workflow paused");
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const runTest = useMutation({
    mutationFn: async (leadId: string | null) => {
      if (dirty) await save.mutateAsync(draft);
      return api<ExecutionDetail>(`/api/v1/workflows/${workflow.id}/run`, { method: "POST", json: { leadId, dryRun: true } });
    },
    onSuccess: (result) => {
      setTest(result);
      setTestOpen(false);
      toast.success(result.status === "FAILED" ? "Test finished with an error" : "Test finished — results are on each step");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/workflows/${workflow.id}`, { method: "DELETE" }),
    onSuccess: () => router.push("/app/workflows"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveNow = React.useCallback(() => {
    if (!parsed.success) return toast.error(issues[0]?.message ?? "Fix the highlighted steps first");
    save.mutate(draft);
  }, [draft, issues, parsed.success, save]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canWrite) saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite, saveNow]);
  React.useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setTest(null);
  };
  const insertStep = (index: number, type: WorkflowStepType) => {
    const step = defaultStep(type);
    const steps = [...draft.steps];
    steps.splice(index, 0, step);
    update({ steps });
    setSelected(step.id);
    setPanel("inspector");
  };
  const replaceStep = (step: WorkflowStep) => update({ steps: draft.steps.map((item) => (item.id === step.id ? step : item)) });
  const moveStep = (id: string, direction: -1 | 1) => {
    const index = draft.steps.findIndex((step) => step.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    const [item] = steps.splice(index, 1);
    if (item) steps.splice(target, 0, item);
    update({ steps });
  };
  const deleteStep = (id: string) => {
    update({ steps: draft.steps.filter((step) => step.id !== id) });
    setSelected("trigger");
  };

  const selectedStep = typeof selected === "string" && selected !== "trigger" ? draft.steps.find((step) => step.id === selected) : undefined;
  const testFor = (stepId: string) => (test ? outcomeText([...test.stepRuns].reverse().find((run) => run.stepId === stepId)) : null);
  const TriggerIcon = TRIGGER_ICONS[draft.trigger.type];
  const canActivate = !dirty && issues.length === 0;

  return (
    <div className="flex h-[calc(100dvh-2.75rem)] min-h-[560px] flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2.5 sm:px-5">
        <Link href="/app/workflows" className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground" aria-label="Back to workflows">
          <ArrowLeft className="size-3.5" />
        </Link>
        <input
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          readOnly={!canWrite}
          aria-label="Workflow name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold tracking-[-0.01em] outline-none hover:border-border focus:border-border-strong"
        />
        <div className="flex items-center gap-2">
          {workflow.status === "ACTIVE" ? (
            <Badge tone="success">
              <span className="size-1.5 rounded-full bg-good" /> Live
            </Badge>
          ) : (
            <Badge tone="neutral">{workflow.status === "PAUSED" ? "Paused" : "Draft"}</Badge>
          )}
          {dirty ? <span className="hidden text-xs text-foreground-muted sm:inline">Unsaved changes</span> : <span className="hidden text-xs text-foreground-subtle sm:inline">v{workflow.version} saved</span>}
          <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "runs" ? "inspector" : "runs")} aria-pressed={panel === "runs"}>
            <History /> Runs
          </Button>
          {canWrite ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setTestOpen(true)} disabled={!parsed.success}>
                <FlaskConical /> Test
              </Button>
              <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={saveNow} disabled={!dirty || save.isPending}>
                <Save /> {save.isPending ? "Saving…" : "Save"}
              </Button>
              {workflow.status === "ACTIVE" ? (
                <Button size="sm" variant="secondary" onClick={() => setStatus.mutate("PAUSED")} disabled={setStatus.isPending}>
                  <Pause /> Pause
                </Button>
              ) : (
                <Tooltip content={dirty ? "Save first" : issues.length ? issues[0]?.message : "Start running on real events"}>
                  <span>
                    <Button size="sm" variant="primary" onClick={() => setStatus.mutate("ACTIVE")} disabled={!canActivate || setStatus.isPending}>
                      <Play /> Activate
                    </Button>
                  </span>
                </Tooltip>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setPanel("runs")}>
                    <History /> Run history
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => window.confirm("Delete this workflow? Waiting runs are canceled.") && remove.mutate()}>
                    <Trash2 /> Delete workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Canvas */}
        <div className="relative min-h-0 flex-1 overflow-auto bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px]">
          {test ? (
            <div className="sticky top-3 z-10 mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs shadow-md">
              <FlaskConical className="size-3.5 text-accent" />
              Test run{test.lead ? ` with ${test.lead.name}` : ""}: <RunStatusBadge status={test.status} />
              {test.stoppedReason ? <span className="text-foreground-muted">stopped: {test.stoppedReason.toLowerCase()}</span> : null}
              <button type="button" className="ml-1 text-foreground-muted hover:text-foreground" onClick={() => setTest(null)} aria-label="Clear test results">
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          <div className="mx-auto flex w-full max-w-[420px] flex-col items-center px-4 py-10">
            <NodeCard
              selected={selected === "trigger"}
              onSelect={() => {
                setSelected("trigger");
                setPanel("inspector");
              }}
              glyph={
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                  <TriggerIcon className="size-4" />
                </span>
              }
              eyebrow="Trigger"
              title={triggerTitle(draft.trigger)}
              summary={triggerDetail(draft.trigger)}
              issues={issuesFor("trigger")}
              test={test ? { tone: "done", text: test.lead ? `Started for ${test.lead.name}` : "Started" } : null}
            />
            {draft.steps.map((step, index) => (
              <React.Fragment key={step.id}>
                <Connector onPick={(type) => insertStep(index, type)} triggerHasLead={triggerHasLead} editable={canWrite} />
                <NodeCard
                  selected={selected === step.id}
                  onSelect={() => {
                    setSelected(step.id);
                    setPanel("inspector");
                  }}
                  glyph={<StepGlyph type={step.type} />}
                  eyebrow={`Step ${index + 1}`}
                  title={STEP_CATALOG[step.type].label}
                  summary={stepSummary(step, { campaigns: options.campaigns })}
                  issues={issuesFor(step.id)}
                  test={testFor(step.id)}
                />
              </React.Fragment>
            ))}
            <Connector onPick={(type) => insertStep(draft.steps.length, type)} triggerHasLead={triggerHasLead} editable={canWrite} />
            <div className="rounded-full border border-dashed border-border-strong bg-surface px-3 py-1 text-[11px] font-medium text-foreground-muted">End</div>
            {!draft.steps.length && canWrite ? <p className="mt-4 text-center text-xs text-foreground-muted">Click + to add the first step.</p> : null}
          </div>
        </div>

        {/* Inspector / runs */}
        <aside className="flex w-full shrink-0 flex-col border-t border-border bg-surface lg:w-[380px] lg:border-t-0 lg:border-l">
          {panel === "runs" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold">Run history</h2>
                <Button size="xs" variant="ghost" onClick={() => setPanel("inspector")}>
                  Close
                </Button>
              </div>
              <RunsPanel workflowId={workflow.id} onOpen={setRunId} />
            </div>
          ) : selected === "trigger" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-foreground text-background">
                  <TriggerIcon className="size-4" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold">Trigger</p>
                  <p className="text-xs text-foreground-muted">What starts this workflow</p>
                </div>
              </div>
              <div className="grid gap-4 p-4">
                <TriggerInspector trigger={draft.trigger} onChange={(trigger) => update({ trigger })} hookUrl={workflow.hookUrl} />
                <Field>
                  <Label htmlFor="wf-description">Description</Label>
                  <Textarea id="wf-description" rows={2} value={draft.description ?? ""} onChange={(event) => update({ description: event.target.value || null })} placeholder="What this automation is for" />
                </Field>
                {issuesFor("trigger").length || issues.some((issue) => issue.stepId === null) ? (
                  <Callout tone="warning" icon={CircleAlert}>
                    {[...issuesFor("trigger"), ...issues.filter((issue) => issue.stepId === null).map((issue) => issue.message)].join(" · ")}
                  </Callout>
                ) : null}
              </div>
            </div>
          ) : selectedStep ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <StepGlyph type={selectedStep.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{STEP_CATALOG[selectedStep.type].label}</p>
                  <p className="truncate text-xs text-foreground-muted">{STEP_CATALOG[selectedStep.type].description}</p>
                </div>
                {canWrite ? (
                  <div className="flex items-center">
                    <Button size="icon-xs" variant="ghost" aria-label="Move up" onClick={() => moveStep(selectedStep.id, -1)} disabled={draft.steps[0]?.id === selectedStep.id}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label="Move down" onClick={() => moveStep(selectedStep.id, 1)} disabled={draft.steps.at(-1)?.id === selectedStep.id}>
                      <ArrowDown />
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label="Delete step" onClick={() => deleteStep(selectedStep.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <fieldset disabled={!canWrite} className="grid gap-4">
                  <StepInspector step={selectedStep} onChange={replaceStep} options={options} signingSecret={workflow.signingSecret} />
                  {issuesFor(selectedStep.id).length ? (
                    <Callout tone="warning" icon={CircleAlert}>
                      {issuesFor(selectedStep.id).join(" · ")}
                    </Callout>
                  ) : null}
                  {test ? (
                    (() => {
                      const outcome = testFor(selectedStep.id);
                      if (!outcome) return null;
                      const Icon = OUTCOME_ICON[outcome.tone];
                      return (
                        <p className={cn("flex items-start gap-1.5 rounded-md bg-surface-muted px-3 py-2 text-xs", OUTCOME_COLOR[outcome.tone])}>
                          <Icon className="mt-px size-3.5 shrink-0" /> Test: {outcome.text}
                        </p>
                      );
                    })()
                  ) : null}
                </fieldset>
              </div>
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-foreground-muted">Select a step to configure it.</p>
          )}
          <div className="border-t border-border px-4 py-2.5 text-[11px] text-foreground-subtle">
            {workflow.runCount} run{workflow.runCount === 1 ? "" : "s"}
            {workflow.lastRunAt ? (
              <>
                {" "}
                · last <RelativeTime value={workflow.lastRunAt} />
              </>
            ) : null}
            {draft.trigger.type === "event" && draft.trigger.conditions.length ? <> · filters: {draft.trigger.conditions.map(conditionText).join(", ")}</> : null}
          </div>
        </aside>
      </div>

      <TestDialog open={testOpen} onOpenChange={setTestOpen} needsLead={triggerHasLead} onRun={(leadId) => runTest.mutate(leadId)} running={runTest.isPending} />
      <RunSheet executionId={runId} onOpenChange={(open) => !open && setRunId(null)} />
    </div>
  );
}
