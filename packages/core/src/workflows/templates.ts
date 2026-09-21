import type { WorkflowInput } from "./schemas";

/** Ready-made automations; creating one copies it into the workspace as a draft to review. */
export interface WorkflowTemplate {
  key: string;
  category: "Replies" | "Leads" | "Calls" | "Integrations";
  definition: WorkflowInput & { description: string };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "positive-reply-follow-up",
    category: "Replies",
    definition: {
      name: "Positive reply → follow up fast",
      description: "When a reply is positive, move the lead to Interested, tell the team and create a same-day follow-up.",
      trigger: { type: "event", eventType: "reply_classified", conditions: [{ field: "event.properties.intent", op: "in", value: ["POSITIVE", "MEETING_REQUEST", "PRICING_REQUEST"] }] },
      steps: [
        { id: "status", type: "update_lead_status", status: "INTERESTED" },
        { id: "notify", type: "notify", title: "{{lead.name}} replied positively", body: "Reply intent: {{event.properties.intent}}. Open the inbox to answer while it's warm." },
        { id: "task", type: "create_task", title: "Reply to {{lead.name}} today", taskType: "FOLLOW_UP", priority: "HIGH", dueInDays: 0 },
      ],
    },
  },
  {
    key: "high-fit-to-campaign",
    category: "Leads",
    definition: {
      name: "High-fit lead → call queue",
      description: "When a newly discovered lead scores 80+, tag it and prepare a call with an AI brief for a human to make.",
      trigger: { type: "event", eventType: "lead_qualified", conditions: [] },
      steps: [
        { id: "fit", type: "condition", match: "all", conditions: [{ field: "lead.score", op: "gte", value: 80 }] },
        { id: "tag", type: "add_tag", tag: "hot" },
        { id: "call", type: "prepare_call", callType: "MANUAL" },
      ],
    },
  },
  {
    key: "callback-requested",
    category: "Calls",
    definition: {
      name: "Call back requested → schedule it",
      description: "When a call ends with “call back later”, create a call task for three days later.",
      trigger: { type: "event", eventType: "call_completed", conditions: [{ field: "event.properties.outcome", op: "in", value: ["CALL_BACK_LATER"] }] },
      steps: [{ id: "task", type: "create_task", title: "Call {{lead.name}} back", taskType: "CALL", priority: "MEDIUM", dueInDays: 3 }],
    },
  },
  {
    key: "not-now-nurture",
    category: "Replies",
    definition: {
      name: "“Not now” → check back in 30 days",
      description: "When a prospect says it's not the right time, stop sequences and draft a check-in email a month later.",
      trigger: { type: "event", eventType: "reply_classified", conditions: [{ field: "event.properties.intent", op: "in", value: ["NOT_NOW"] }] },
      steps: [
        { id: "stop", type: "stop_sequences" },
        { id: "wait", type: "delay", amount: 30, unit: "days" },
        { id: "email", type: "send_email", subject: "Checking back in", body: "Hi,\n\nYou mentioned last month that the timing wasn't right — is now a better moment to pick this up?\n\nBest,", requireApproval: true },
      ],
    },
  },
  {
    key: "meeting-to-n8n",
    category: "Integrations",
    definition: {
      name: "Meeting booked → sync via n8n",
      description: "Send every booked meeting to an n8n workflow (e.g. Google Calendar, Sheets or your CRM) and notify the team.",
      trigger: { type: "event", eventType: "meeting_created", conditions: [] },
      steps: [
        { id: "n8n", type: "n8n", webhookPath: "reachai-meeting-booked", waitForCallback: false, timeoutHours: 24 },
        { id: "notify", type: "notify", title: "Meeting booked with {{lead.name}}", body: "Synced to n8n." },
      ],
    },
  },
  {
    key: "opt-out-alert",
    category: "Leads",
    definition: {
      name: "Opt-out → alert the owner",
      description: "Let the team know whenever someone asks not to be contacted, so nobody reaches out by hand.",
      trigger: { type: "event", eventType: "opt_out", conditions: [] },
      steps: [{ id: "notify", type: "notify", title: "{{lead.name}} opted out", body: "They've been added to the suppression list across every channel." }],
    },
  },
];

export function getTemplate(key: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.key === key);
}
