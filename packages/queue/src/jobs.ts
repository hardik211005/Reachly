import { z } from "zod";

/**
 * Job catalogue. Every background job is declared here with its queue and a Zod schema
 * for its payload, so producers (web/API) and consumers (worker) share one contract.
 * Payloads carry ids, never whole records — processors re-read fresh state.
 */

export const QUEUE_NAMES = [
  "discovery",
  "enrichment",
  "scoring",
  "outreach",
  "messaging",
  "voice",
  "sequences",
  "workflows",
  "webhooks",
  "events",
  "analytics",
  "notifications",
  "maintenance",
  "demo",
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export const DEAD_LETTER_QUEUE = "dead-letter";

const uuid = z.uuid();
const org = z.object({ organizationId: uuid });

export const JOBS = {
  // Lead engine
  "discovery.run": { queue: "discovery", schema: org.extend({ runId: uuid }) },
  "leads.enrich": {
    queue: "enrichment",
    schema: org.extend({ leadId: uuid, runId: uuid.optional(), thenScore: z.boolean().default(true) }),
  },
  "leads.score": {
    queue: "scoring",
    schema: org.extend({ leadId: uuid, runId: uuid.optional(), campaignId: uuid.optional() }),
  },
  "leads.import": { queue: "enrichment", schema: org.extend({ importJobId: uuid }) },

  // Campaigns & outreach
  "campaigns.launch": { queue: "outreach", schema: org.extend({ campaignId: uuid }) },
  "outreach.prepare-step": { queue: "outreach", schema: org.extend({ campaignLeadId: uuid }) },
  "messages.send": { queue: "messaging", schema: org.extend({ messageId: uuid }) },
  "conversations.analyze-inbound": { queue: "messaging", schema: org.extend({ messageId: uuid }) },
  "sequences.tick": { queue: "sequences", schema: z.object({}) },

  // Voice
  "calls.start": { queue: "voice", schema: org.extend({ callId: uuid }) },
  "calls.analyze": { queue: "voice", schema: org.extend({ callId: uuid }) },

  // Automation
  "events.fanout": { queue: "events", schema: org.extend({ eventId: uuid }) },
  "workflows.execute": { queue: "workflows", schema: org.extend({ executionId: uuid }) },
  "workflows.resume-due": { queue: "workflows", schema: z.object({}) },
  "webhooks.process": { queue: "webhooks", schema: z.object({ webhookEventId: uuid }) },
  "webhooks.deliver": { queue: "webhooks", schema: z.object({ deliveryId: uuid }) },

  // Analytics
  "analytics.insights": { queue: "analytics", schema: org },
  "analytics.insights-all": { queue: "analytics", schema: z.object({}) },
  "analytics.daily-summary": { queue: "analytics", schema: org },

  // Notifications
  "notifications.deliver": { queue: "notifications", schema: z.object({ notificationId: uuid }) },

  // Housekeeping
  "maintenance.cleanup": { queue: "maintenance", schema: z.object({}) },

  // Demo-mode provider simulator (only enqueued when DEMO_MODE + DEMO_SIMULATE_EVENTS)
  "demo.simulate": {
    queue: "demo",
    schema: org.extend({
      kind: z.enum(["email", "whatsapp", "call"]),
      refId: uuid,
      step: z.string(),
    }),
  },
} as const satisfies Record<string, { queue: QueueName; schema: z.ZodType }>;

export type JobName = keyof typeof JOBS;
export type JobData<N extends JobName> = z.input<(typeof JOBS)[N]["schema"]>;
export type ParsedJobData<N extends JobName> = z.output<(typeof JOBS)[N]["schema"]>;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

export function isJobName(value: string): value is JobName {
  return value in JOBS;
}

export function parseJobData<N extends JobName>(name: N, data: unknown): ParsedJobData<N> {
  return JOBS[name].schema.parse(data) as ParsedJobData<N>;
}

/** Recurring jobs. Cron patterns use the server timezone. */
export const SCHEDULES: Array<{
  id: string;
  job: JobName;
  everyMs?: number;
  pattern?: string;
  /** Interval used by the inline driver to approximate cron patterns. */
  inlineEveryMs: number;
}> = [
  { id: "sequences-tick", job: "sequences.tick", everyMs: 60_000, inlineEveryMs: 60_000 },
  { id: "workflows-resume", job: "workflows.resume-due", everyMs: 60_000, inlineEveryMs: 60_000 },
  {
    id: "insights-daily",
    job: "analytics.insights-all",
    pattern: "0 6 * * *",
    inlineEveryMs: 6 * 60 * 60_000,
  },
  {
    id: "maintenance-daily",
    job: "maintenance.cleanup",
    pattern: "30 3 * * *",
    inlineEveryMs: 24 * 60 * 60_000,
  },
];

export const DEFAULT_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 2_000;

/** Exponential backoff with jitter: 2s, 4s, 8s, 16s … capped at 5 minutes. */
export function backoffDelayMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
  return Math.round(base * (0.85 + Math.random() * 0.3));
}
