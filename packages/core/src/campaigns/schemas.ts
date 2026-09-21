import { AUTOMATION_MODES, CHANNELS } from "@repo/config";
import { z } from "zod";

export const campaignLocationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  city: z.string().trim().max(120).nullable().default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});

/** Who a campaign targets. Also the shape of discovery search criteria. */
export const campaignTargetSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  locations: z.array(campaignLocationSchema).max(10).default([]),
  radiusKm: z.number().int().min(1).max(500).default(25),
  criteria: z.string().trim().max(1000).nullable().default(null),
  companySize: z.string().trim().max(80).nullable().default(null),
  requireWebsite: z.boolean().default(false),
  requireContact: z.boolean().default(true),
});
export type CampaignTarget = z.output<typeof campaignTargetSchema>;

export const dailyLimitsSchema = z
  .object({
    EMAIL: z.number().int().min(0).max(5000).optional(),
    WHATSAPP: z.number().int().min(0).max(5000).optional(),
    VOICE: z.number().int().min(0).max(1000).optional(),
    MANUAL_CALL: z.number().int().min(0).max(1000).optional(),
  })
  .default({});
export type DailyLimits = z.output<typeof dailyLimitsSchema>;

export const DEFAULT_DAILY_LIMITS: Required<DailyLimits> = { EMAIL: 50, WHATSAPP: 30, VOICE: 20, MANUAL_CALL: 25 };

export const campaignStepInputSchema = z.object({
  channel: z.enum(CHANNELS),
  delayDays: z.number().int().min(0).max(60),
  condition: z.enum(["ALWAYS", "NO_REPLY"]).default("NO_REPLY"),
  name: z.string().trim().min(1).max(80),
  subject: z.string().trim().max(200).nullable().default(null),
  body: z.string().trim().min(1).max(5000),
  useAI: z.boolean().default(true),
});
export type CampaignStepInput = z.input<typeof campaignStepInputSchema>;

export const campaignInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().default(null),
  automationMode: z.enum(AUTOMATION_MODES).default("ASSISTED"),
  target: campaignTargetSchema,
  offeringIds: z.array(z.uuid()).max(20).default([]),
  offerSummary: z.string().trim().max(1000).nullable().default(null),
  pitchAngle: z.string().trim().max(1000).nullable().default(null),
  tone: z.string().trim().max(60).default("professional"),
  channels: z.array(z.enum(CHANNELS)).min(1, "Pick at least one channel"),
  dailyLimits: dailyLimitsSchema,
  minLeadScore: z.number().int().min(0).max(100).default(60),
  steps: z.array(campaignStepInputSchema).max(10).optional(),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;
export type CampaignData = z.output<typeof campaignInputSchema>;

/**
 * Default outreach sequence for the chosen channels: an opener, a follow-up on a second
 * channel if available, and a short final nudge. Bodies are templates the Outreach
 * Agent personalises per lead ({{variables}} are filled from lead data).
 */
export function defaultSequence(channels: Array<(typeof CHANNELS)[number]>): CampaignStepInput[] {
  const primary = channels.includes("EMAIL") ? "EMAIL" : (channels[0] ?? "EMAIL");
  const secondary = channels.find((channel) => channel !== primary && channel !== "MANUAL_CALL" && channel !== "VOICE");
  const steps: CampaignStepInput[] = [
    {
      channel: primary,
      delayDays: 0,
      condition: "ALWAYS",
      name: "Opener",
      subject: primary === "EMAIL" ? "Quick idea for {{business_name}}" : null,
      body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}",
      useAI: true,
    },
    {
      channel: secondary ?? primary,
      delayDays: 3,
      condition: "NO_REPLY",
      name: "Follow-up",
      subject: (secondary ?? primary) === "EMAIL" ? "Re: Quick idea for {{business_name}}" : null,
      body: "Hi {{first_name}}, following up on my note — {{follow_up_hook}}. Would a quick call this week be useful?",
      useAI: true,
    },
    {
      channel: primary,
      delayDays: 4,
      condition: "NO_REPLY",
      name: "Final nudge",
      subject: primary === "EMAIL" ? "Should I close the loop?" : null,
      body: "Hi {{first_name}}, I don't want to crowd your inbox. If {{offer_short}} isn't a priority right now, no problem — just let me know and I won't follow up again.",
      useAI: true,
    },
  ];
  if (channels.includes("VOICE") || channels.includes("MANUAL_CALL")) {
    steps.splice(2, 0, {
      channel: channels.includes("VOICE") ? "VOICE" : "MANUAL_CALL",
      delayDays: 2,
      condition: "NO_REPLY",
      name: "Call",
      subject: null,
      body: "Introduce yourself, reference the earlier message, qualify interest and ask for a short meeting.",
      useAI: true,
    });
  }
  return steps;
}
