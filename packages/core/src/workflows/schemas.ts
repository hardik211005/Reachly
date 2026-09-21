import { CALL_OUTCOMES, LEAD_STATUSES, REPLY_INTENTS } from "@repo/config";
import { z } from "zod";

/**
 * Workflow definitions: one trigger and an ordered list of steps. Stored as JSON on
 * `Workflow.trigger` / `Workflow.steps`; this module has no database imports so the
 * visual builder can validate with the same schemas.
 */

// ----------------------------------------------------------------------------- Triggers

export const WORKFLOW_EVENT_TRIGGERS = [
  "lead_created",
  "lead_qualified",
  "lead_status_changed",
  "reply_classified",
  "opt_out",
  "call_completed",
  "meeting_created",
  "campaign_completed",
  "discovery_completed",
  "deal_stage_changed",
  "deal_won",
  "quote_accepted",
] as const;
export type WorkflowEventTrigger = (typeof WORKFLOW_EVENT_TRIGGERS)[number];

export const EVENT_TRIGGER_META: Record<WorkflowEventTrigger, { label: string; description: string; hasLead: boolean }> = {
  lead_created: { label: "Lead discovered", description: "A new lead is added by discovery, import or by hand", hasLead: true },
  lead_qualified: { label: "Lead qualified", description: "A lead's score crosses the qualification threshold", hasLead: true },
  lead_status_changed: { label: "Lead status changed", description: "A lead moves to another status", hasLead: true },
  reply_classified: { label: "Reply received", description: "An email or WhatsApp reply is classified by AI", hasLead: true },
  opt_out: { label: "Opted out", description: "A lead asks not to be contacted", hasLead: true },
  call_completed: { label: "Call completed", description: "An AI or manual call ends with an outcome", hasLead: true },
  meeting_created: { label: "Meeting booked", description: "A meeting is booked from a reply or call", hasLead: true },
  campaign_completed: { label: "Campaign completed", description: "A campaign finishes", hasLead: false },
  discovery_completed: { label: "Discovery finished", description: "A discovery run finishes", hasLead: false },
  deal_stage_changed: { label: "Deal stage changed", description: "A deal moves in the pipeline", hasLead: true },
  deal_won: { label: "Deal won", description: "A deal is marked won", hasLead: true },
  quote_accepted: { label: "Quote accepted", description: "A prospect accepts a quote", hasLead: true },
};

export const CONDITION_OPERATORS = ["equals", "not_equals", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "exists", "not_exists"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const conditionSchema = z.object({
  field: z.string().trim().min(1).max(80),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(200), z.number(), z.array(z.string().max(80)).max(20), z.null()]).default(null),
});
export type WorkflowCondition = z.infer<typeof conditionSchema>;

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), eventType: z.enum(WORKFLOW_EVENT_TRIGGERS), conditions: z.array(conditionSchema).max(10).default([]) }),
  z.object({ type: z.literal("schedule"), frequency: z.enum(["daily", "weekly"]), hour: z.number().int().min(0).max(23), weekday: z.number().int().min(0).max(6).default(1) }),
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("manual") }),
]);
export type WorkflowTrigger = z.infer<typeof triggerSchema>;

// ----------------------------------------------------------------------------- Steps

const id = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("condition"), match: z.enum(["all", "any"]).default("all"), conditions: z.array(conditionSchema).min(1).max(10) }),
  z.object({ id, type: z.literal("delay"), amount: z.number().int().min(1).max(90), unit: z.enum(["minutes", "hours", "days"]) }),
  z.object({ id, type: z.literal("update_lead_status"), status: z.enum(LEAD_STATUSES).exclude(["DO_NOT_CONTACT"]) }),
  z.object({ id, type: z.literal("add_tag"), tag: text(40).min(1) }),
  z.object({
    id,
    type: z.literal("create_task"),
    title: text(200).min(1),
    taskType: z.enum(["TODO", "CALL", "EMAIL", "FOLLOW_UP", "MEETING"]).default("FOLLOW_UP"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
    dueInDays: z.number().int().min(0).max(90).default(1),
  }),
  z.object({ id, type: z.literal("add_to_campaign"), campaignId: z.uuid() }),
  z.object({ id, type: z.literal("stop_sequences") }),
  z.object({ id, type: z.literal("notify"), title: text(160).min(1), body: text(1000).default("") }),
  z.object({ id, type: z.literal("send_email"), subject: text(200).min(1), body: text(5000).min(1), requireApproval: z.boolean().default(true) }),
  z.object({ id, type: z.literal("prepare_call"), callType: z.enum(["AI_AGENT", "MANUAL"]).default("MANUAL") }),
  z.object({ id, type: z.literal("webhook"), url: z.url().max(500), includeLead: z.boolean().default(true) }),
  z.object({ id, type: z.literal("n8n"), webhookPath: text(200).min(1), waitForCallback: z.boolean().default(false), timeoutHours: z.number().int().min(1).max(72).default(24) }),
]);
export type WorkflowStep = z.infer<typeof stepSchema>;
export type WorkflowStepType = WorkflowStep["type"];

export const workflowInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  trigger: triggerSchema,
  steps: z.array(stepSchema).max(25).default([]),
});
export type WorkflowInput = z.input<typeof workflowInputSchema>;
export type WorkflowDefinition = z.output<typeof workflowInputSchema>;

// ----------------------------------------------------------------------------- Catalogue (builder + validation)

export type StepCategory = "logic" | "lead" | "outreach" | "team" | "integrations";

export const STEP_CATALOG: Record<WorkflowStepType, { label: string; description: string; category: StepCategory; needsLead: boolean; icon: string }> = {
  condition: { label: "Only continue if…", description: "Stop unless conditions match", category: "logic", needsLead: false, icon: "filter" },
  delay: { label: "Wait", description: "Pause before the next step", category: "logic", needsLead: false, icon: "clock" },
  update_lead_status: { label: "Update lead status", description: "Move the lead to another status", category: "lead", needsLead: true, icon: "tag" },
  add_tag: { label: "Add tag", description: "Tag the lead", category: "lead", needsLead: true, icon: "hash" },
  add_to_campaign: { label: "Add to campaign", description: "Enrol the lead in a campaign", category: "outreach", needsLead: true, icon: "megaphone" },
  stop_sequences: { label: "Stop sequences", description: "Stop all running campaign sequences for the lead", category: "outreach", needsLead: true, icon: "octagon" },
  send_email: { label: "Send email", description: "Email the lead (as a draft for approval by default)", category: "outreach", needsLead: true, icon: "mail" },
  prepare_call: { label: "Prepare a call", description: "Create a call with an AI brief in the call queue", category: "outreach", needsLead: true, icon: "phone" },
  create_task: { label: "Create task", description: "Add a task for the team", category: "team", needsLead: false, icon: "check-square" },
  notify: { label: "Notify the team", description: "In-app notification (and Slack if connected)", category: "team", needsLead: false, icon: "bell" },
  webhook: { label: "Send webhook", description: "POST signed JSON to any HTTPS endpoint", category: "integrations", needsLead: false, icon: "webhook" },
  n8n: { label: "Run n8n workflow", description: "Trigger an n8n workflow, optionally wait for its result", category: "integrations", needsLead: false, icon: "workflow" },
};

/** Fields that conditions can test, with the kind of value they hold. */
export const CONDITION_FIELDS: Array<{ field: string; label: string; kind: "text" | "number" | "enum" | "list"; options?: readonly string[] }> = [
  { field: "lead.status", label: "Lead status", kind: "enum", options: LEAD_STATUSES },
  { field: "lead.score", label: "Lead score", kind: "number" },
  { field: "lead.fitTier", label: "Fit tier", kind: "enum", options: ["HIGH", "MEDIUM", "LOW"] },
  { field: "lead.city", label: "Lead city", kind: "text" },
  { field: "lead.category", label: "Lead category", kind: "text" },
  { field: "lead.tags", label: "Lead tags", kind: "list" },
  { field: "lead.email", label: "Lead email", kind: "text" },
  { field: "lead.phone", label: "Lead phone", kind: "text" },
  { field: "event.properties.intent", label: "Reply intent", kind: "enum", options: REPLY_INTENTS },
  { field: "event.properties.outcome", label: "Call outcome", kind: "enum", options: CALL_OUTCOMES },
  { field: "event.properties.to", label: "New lead status", kind: "enum", options: LEAD_STATUSES },
  { field: "event.channel", label: "Channel", kind: "enum", options: ["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"] },
];

/** Variables usable as {{…}} in text fields. */
export const TEMPLATE_FIELDS = [
  { key: "lead.name", label: "Lead name" },
  { key: "lead.city", label: "City" },
  { key: "lead.status", label: "Lead status" },
  { key: "lead.score", label: "Lead score" },
  { key: "lead.contactName", label: "Contact name" },
  { key: "lead.url", label: "Lead link" },
  { key: "event.label", label: "Trigger" },
  { key: "event.properties.intent", label: "Reply intent" },
  { key: "event.properties.outcome", label: "Call outcome" },
  { key: "workflow.name", label: "Workflow name" },
] as const;

export interface WorkflowIssue {
  stepId: string | null;
  message: string;
}

/** Structural problems that block activation (shown on the builder's nodes). */
export function validateDefinition(definition: WorkflowDefinition, context: { n8nAllowed: boolean; campaignIds?: string[] }): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const triggerHasLead =
    definition.trigger.type === "event" ? EVENT_TRIGGER_META[definition.trigger.eventType].hasLead : definition.trigger.type === "manual" || definition.trigger.type === "webhook";
  if (!definition.steps.length) issues.push({ stepId: null, message: "Add at least one step" });
  const seen = new Set<string>();
  for (const step of definition.steps) {
    if (seen.has(step.id)) issues.push({ stepId: step.id, message: "Duplicate step id" });
    seen.add(step.id);
    if (STEP_CATALOG[step.type].needsLead && !triggerHasLead) issues.push({ stepId: step.id, message: `“${STEP_CATALOG[step.type].label}” needs a lead, but this trigger doesn't have one` });
    if (step.type === "n8n" && !context.n8nAllowed) issues.push({ stepId: step.id, message: "n8n steps aren't included in your plan" });
    if (step.type === "add_to_campaign" && context.campaignIds && !context.campaignIds.includes(step.campaignId)) issues.push({ stepId: step.id, message: "Pick a campaign that still exists" });
  }
  return issues;
}
