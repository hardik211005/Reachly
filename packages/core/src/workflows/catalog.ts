import type { WorkflowStepType } from "./schemas";

/**
 * What each workflow step is called and does. Plain data with no zod, so browser pages (like the
 * marketing site's product facts) can use it without downloading the validation library.
 */

export type StepCategory = "logic" | "lead" | "outreach" | "team" | "integrations";

export const STEP_CATALOG: Record<WorkflowStepType, { label: string; description: string; category: StepCategory; needsLead: boolean; icon: string }> = {
  condition: { label: "Only continue if…", description: "Stop unless conditions match", category: "logic", needsLead: false, icon: "filter" },
  delay: { label: "Wait", description: "Pause before the next step", category: "logic", needsLead: false, icon: "clock" },
  update_lead_status: { label: "Update lead status", description: "Move the lead to another status", category: "lead", needsLead: true, icon: "tag" },
  add_tag: { label: "Add tag", description: "Tag the lead", category: "lead", needsLead: true, icon: "hash" },
  move_deal: { label: "Move deal forward", description: "Open the lead's deal or move it to a later stage (never backwards)", category: "lead", needsLead: true, icon: "handshake" },
  add_to_campaign: { label: "Add to campaign", description: "Enrol the lead in a campaign", category: "outreach", needsLead: true, icon: "megaphone" },
  stop_sequences: { label: "Stop sequences", description: "Stop all running campaign sequences for the lead", category: "outreach", needsLead: true, icon: "octagon" },
  send_email: { label: "Send email", description: "Email the lead (as a draft for approval by default)", category: "outreach", needsLead: true, icon: "mail" },
  prepare_call: { label: "Prepare a call", description: "Create a call with an AI brief in the call queue", category: "outreach", needsLead: true, icon: "phone" },
  create_task: { label: "Create task", description: "Add a task for the team", category: "team", needsLead: false, icon: "check-square" },
  notify: { label: "Notify the team", description: "In-app notification (and Slack if connected)", category: "team", needsLead: false, icon: "bell" },
  webhook: { label: "Send webhook", description: "POST signed JSON to any HTTPS endpoint", category: "integrations", needsLead: false, icon: "webhook" },
  n8n: { label: "Run n8n workflow", description: "Trigger an n8n workflow, optionally wait for its result", category: "integrations", needsLead: false, icon: "workflow" },
};
