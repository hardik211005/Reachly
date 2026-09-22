"use client";

import {
  Bell,
  CalendarClock,
  CircleStop,
  Clock,
  Filter,
  Handshake,
  Hash,
  ListChecks,
  Mail,
  Megaphone,
  Phone,
  Play,
  Tag,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CALL_OUTCOME_LABELS, DEAL_STAGE_LABELS, LEAD_STATUS_LABELS, REPLY_INTENT_LABELS, type CallOutcome, type LeadStatus, type ReplyIntent } from "@repo/config";
import { CONDITION_FIELDS, EVENT_TRIGGER_META, STEP_CATALOG, type WorkflowCondition, type WorkflowStep, type WorkflowStepType, type WorkflowTrigger } from "@repo/core/workflows/schemas";
import { StatusBadge, cn, type StatusTone } from "@repo/ui";

export const STEP_ICONS: Record<WorkflowStepType, LucideIcon> = {
  condition: Filter,
  delay: Clock,
  update_lead_status: Tag,
  add_tag: Hash,
  move_deal: Handshake,
  add_to_campaign: Megaphone,
  stop_sequences: CircleStop,
  send_email: Mail,
  prepare_call: Phone,
  create_task: ListChecks,
  notify: Bell,
  webhook: Webhook,
  n8n: Workflow,
};

export const TRIGGER_ICONS: Record<WorkflowTrigger["type"], LucideIcon> = { event: Zap, schedule: CalendarClock, webhook: Webhook, manual: Play };

export const CATEGORY_TONES: Record<string, string> = {
  logic: "bg-surface-sunken text-foreground-secondary",
  lead: "bg-accent-soft text-accent-soft-foreground",
  outreach: "bg-[color-mix(in_srgb,var(--series-3)_16%,transparent)] text-[var(--series-3)]",
  team: "bg-warning-soft text-warning-text",
  integrations: "bg-[color-mix(in_srgb,var(--series-7)_16%,transparent)] text-[var(--series-7)]",
};

export function StepGlyph({ type, className }: { type: WorkflowStepType; className?: string }) {
  const Icon = STEP_ICONS[type];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", CATEGORY_TONES[STEP_CATALOG[type].category], className)}>
      <Icon className="size-4" />
    </span>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function valueLabel(field: string, value: unknown): string {
  const one = (item: unknown) => {
    const text = String(item);
    if (field.endsWith("intent")) return REPLY_INTENT_LABELS[text as ReplyIntent] ?? text;
    if (field.endsWith("outcome")) return CALL_OUTCOME_LABELS[text as CallOutcome] ?? text;
    if (field.endsWith("status") || field.endsWith(".to")) return LEAD_STATUS_LABELS[text as LeadStatus] ?? text;
    return text;
  };
  return Array.isArray(value) ? value.map(one).join(" or ") : one(value);
}

const OP_TEXT: Record<WorkflowCondition["op"], string> = {
  equals: "is",
  not_equals: "is not",
  in: "is",
  not_in: "is not",
  contains: "contains",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  exists: "is set",
  not_exists: "is empty",
};

export function conditionText(condition: WorkflowCondition): string {
  const field = CONDITION_FIELDS.find((item) => item.field === condition.field)?.label ?? condition.field;
  if (condition.op === "exists" || condition.op === "not_exists") return `${field} ${OP_TEXT[condition.op]}`;
  return `${field} ${OP_TEXT[condition.op]} ${valueLabel(condition.field, condition.value)}`;
}

export function triggerTitle(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case "event":
      return EVENT_TRIGGER_META[trigger.eventType].label;
    case "schedule":
      return trigger.frequency === "daily" ? `Every day at ${String(trigger.hour).padStart(2, "0")}:00` : `Every ${WEEKDAYS[trigger.weekday]} at ${String(trigger.hour).padStart(2, "0")}:00`;
    case "webhook":
      return "Incoming webhook";
    case "manual":
      return "Run manually";
  }
}

export function triggerDetail(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case "event":
      return trigger.conditions.length ? `When ${trigger.conditions.map(conditionText).join(" and ")}` : EVENT_TRIGGER_META[trigger.eventType].description;
    case "schedule":
      return "Runs on a schedule in your workspace timezone";
    case "webhook":
      return "Starts when n8n or another system calls this workflow's URL";
    case "manual":
      return "Starts when someone runs it from here";
  }
}

export function stepSummary(step: WorkflowStep, lookups: { campaigns?: Array<{ id: string; name: string }> } = {}): string {
  switch (step.type) {
    case "condition":
      return step.conditions.map(conditionText).join(step.match === "all" ? " and " : " or ") || "Add a condition";
    case "delay":
      return `${step.amount} ${step.amount === 1 ? step.unit.replace(/s$/, "") : step.unit}`;
    case "update_lead_status":
      return `Set to ${LEAD_STATUS_LABELS[step.status]}`;
    case "add_tag":
      return `#${step.tag}`;
    case "move_deal":
      return `To ${DEAL_STAGE_LABELS[step.stage]} (or keep a later stage)`;
    case "create_task":
      return `${step.title} · due ${step.dueInDays === 0 ? "today" : `in ${step.dueInDays}d`}`;
    case "add_to_campaign":
      return lookups.campaigns?.find((campaign) => campaign.id === step.campaignId)?.name ?? "Choose a campaign";
    case "stop_sequences":
      return "Every running campaign for this lead";
    case "notify":
      return step.title;
    case "send_email":
      return `${step.subject}${step.requireApproval ? " · draft for approval" : " · sent automatically"}`;
    case "prepare_call":
      return step.callType === "AI_AGENT" ? "AI voice agent (waits in the call queue)" : "Manual call with an AI brief";
    case "webhook":
      return step.url.replace(/^https?:\/\//, "");
    case "n8n":
      return `/webhook/${step.webhookPath}${step.waitForCallback ? " · waits for result" : ""}`;
  }
}

const RUN_TONES: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Queued", tone: "muted" },
  RUNNING: { label: "Running", tone: "accent" },
  WAITING: { label: "Waiting", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELED: { label: "Canceled", tone: "muted" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const meta = RUN_TONES[status] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

export function runDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

let stepCounter = 0;
/** Short, stable-looking ids for new steps (unique within a workflow). */
export function newStepId(type: WorkflowStepType): string {
  stepCounter += 1;
  return `${type.replace(/_/g, "-")}-${Date.now().toString(36).slice(-4)}${stepCounter}`;
}

/** Sensible defaults for a newly inserted step. */
export function defaultStep(type: WorkflowStepType): WorkflowStep {
  const id = newStepId(type);
  switch (type) {
    case "condition":
      return { id, type, match: "all", conditions: [{ field: "lead.score", op: "gte", value: 70 }] };
    case "delay":
      return { id, type, amount: 1, unit: "days" };
    case "update_lead_status":
      return { id, type, status: "INTERESTED" };
    case "add_tag":
      return { id, type, tag: "follow-up" };
    case "move_deal":
      return { id, type, stage: "INTERESTED" };
    case "create_task":
      return { id, type, title: "Follow up with {{lead.name}}", taskType: "FOLLOW_UP", priority: "MEDIUM", dueInDays: 1 };
    case "add_to_campaign":
      return { id, type, campaignId: "00000000-0000-4000-8000-000000000000" };
    case "stop_sequences":
      return { id, type };
    case "notify":
      return { id, type, title: "{{lead.name}}: {{event.label}}", body: "" };
    case "send_email":
      return { id, type, subject: "Quick follow-up", body: "Hi,\n\n…\n\nBest,", requireApproval: true };
    case "prepare_call":
      return { id, type, callType: "MANUAL" };
    case "webhook":
      return { id, type, url: "https://example.com/hooks/reachai", includeLead: true };
    case "n8n":
      return { id, type, webhookPath: "reachai-event", waitForCallback: false, timeoutHours: 24 };
  }
}
