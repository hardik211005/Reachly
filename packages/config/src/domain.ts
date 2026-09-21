/**
 * Domain vocabularies shared by the database layer, API and UI.
 * The Prisma enums in packages/db mirror these lists; packages/db has a compile-time
 * check that fails the build if the two drift apart.
 */

export const LEAD_STATUSES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "MEETING",
  "QUOTE_SENT",
  "WON",
  "LOST",
  "DO_NOT_CONTACT",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  INTERESTED: "Interested",
  MEETING: "Meeting",
  QUOTE_SENT: "Quote sent",
  WON: "Won",
  LOST: "Lost",
  DO_NOT_CONTACT: "Do not contact",
};

export const DEAL_STAGES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "INTERESTED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  MEETING: "Meeting",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

/** Default win probability per stage, used when a deal has no explicit probability. */
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  NEW: 5,
  QUALIFIED: 10,
  CONTACTED: 15,
  INTERESTED: 30,
  MEETING: 45,
  PROPOSAL: 60,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export const CHANNELS = ["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  VOICE: "AI voice",
  MANUAL_CALL: "Manual call",
};

export const AUTOMATION_MODES = ["MANUAL", "ASSISTED", "AUTOMATED"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const AUTOMATION_MODE_LABELS: Record<AutomationMode, { label: string; description: string }> =
  {
    MANUAL: {
      label: "Manual",
      description: "You review and send every message and call yourself.",
    },
    ASSISTED: {
      label: "Assisted",
      description: "AI prepares messages and calls; each action waits for your approval.",
    },
    AUTOMATED: {
      label: "Automated",
      description:
        "Actions run on your rules, daily limits and send windows, within provider policies.",
    },
  };

export const CALL_OUTCOMES = [
  "INTERESTED",
  "NOT_INTERESTED",
  "CALL_BACK_LATER",
  "NEEDS_INFORMATION",
  "MEETING_REQUESTED",
  "WRONG_CONTACT",
  "DO_NOT_CONTACT",
  "UNKNOWN",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  INTERESTED: "Interested",
  NOT_INTERESTED: "Not interested",
  CALL_BACK_LATER: "Call back later",
  NEEDS_INFORMATION: "Needs information",
  MEETING_REQUESTED: "Meeting requested",
  WRONG_CONTACT: "Wrong contact",
  DO_NOT_CONTACT: "Do not contact",
  UNKNOWN: "Unknown",
};

/** Intent labels produced by conversation analysis for inbound replies. */
export const REPLY_INTENTS = [
  "POSITIVE",
  "MEETING_REQUEST",
  "QUESTION",
  "PRICING_REQUEST",
  "NOT_NOW",
  "NEGATIVE",
  "OPT_OUT",
  "WRONG_PERSON",
  "OUT_OF_OFFICE",
  "OTHER",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const REPLY_INTENT_LABELS: Record<ReplyIntent, string> = {
  POSITIVE: "Positive",
  MEETING_REQUEST: "Meeting request",
  QUESTION: "Question",
  PRICING_REQUEST: "Pricing request",
  NOT_NOW: "Not now",
  NEGATIVE: "Negative",
  OPT_OUT: "Opt-out",
  WRONG_PERSON: "Wrong person",
  OUT_OF_OFFICE: "Out of office",
  OTHER: "Other",
};

/** Intents counted as a positive reply in analytics. QUESTION counts as engaged, not positive. */
export const POSITIVE_INTENTS: readonly ReplyIntent[] = ["POSITIVE", "MEETING_REQUEST", "PRICING_REQUEST"];

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const BUSINESS_SIZES = ["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;
export type BusinessSize = (typeof BUSINESS_SIZES)[number];

export const BUSINESS_SIZE_LABELS: Record<BusinessSize, string> = {
  SOLO: "Solo / freelancer",
  SMALL: "2–10 people",
  MEDIUM: "11–50 people",
  LARGE: "51–250 people",
  ENTERPRISE: "250+ people",
};

export const USAGE_METRICS = [
  "LEAD_CREDITS",
  "AI_CREDITS",
  "EMAIL_SENDS",
  "WHATSAPP_MESSAGES",
  "VOICE_MINUTES",
  "WORKFLOW_EXECUTIONS",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const USAGE_METRIC_LABELS: Record<UsageMetric, { label: string; unit: string }> = {
  LEAD_CREDITS: { label: "Lead credits", unit: "leads" },
  AI_CREDITS: { label: "AI credits", unit: "credits" },
  EMAIL_SENDS: { label: "Emails", unit: "emails" },
  WHATSAPP_MESSAGES: { label: "WhatsApp messages", unit: "messages" },
  VOICE_MINUTES: { label: "Voice minutes", unit: "minutes" },
  WORKFLOW_EXECUTIONS: { label: "Workflow runs", unit: "runs" },
};
