import { createHash, randomUUID } from "node:crypto";
import type { ReplyIntent } from "@repo/config";
import { matchCity } from "@repo/config/taxonomy";
import type { Channel, Contact, Lead, Prisma } from "@repo/db";
import { analyzeConversationDeterministically } from "../ai/agents/conversation-analysis";
import { composeOutreachMessage } from "../ai/agents/outreach";
import { consumeUsage } from "../billing/usage";
import { addLeadsToCampaign } from "../campaigns/audience";
import { createCampaign } from "../campaigns/service";
import type { CampaignStepInput } from "../campaigns/schemas";
import { addSuppression } from "../compliance/suppression";
import type { TenantContext } from "../context";
import { executeDiscoveryRun, startDiscovery } from "../discovery/service";
import { recordEvent } from "../events";
import { leadContext, primaryContact, sellerContext } from "../outreach/context";
import { findOrCreateConversation } from "../outreach/conversations";
import { resolveEmailProvider } from "../outreach/providers";
import { prepareCampaignStep } from "../outreach/sequence";
import { syncWhatsAppTemplates } from "../outreach/whatsapp-templates";

/**
 * Demo outreach history for "Demo Growth Agency": leads discovered through the real
 * pipeline (mock provider), three campaigns and ~6 weeks of backdated sends, deliveries,
 * opens, classified replies, opt-outs and meetings. Every row is written the way the
 * running app writes it, so analytics, timelines and the inbox read real records.
 * All of it is simulated and labelled as demo data in the UI.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

function unit(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0) / 0xffffffff;
}

/** 10:30 in India (05:00 UTC) N days ago. */
function morning(daysAgo: number): Date {
  const date = new Date(Date.now() - daysAgo * DAY);
  date.setUTCHours(5, 0, 0, 0);
  return date;
}

// ----------------------------------------------------------------------------- Replies

const REPLIES: Array<{ intent: ReplyIntent; weight: number; email: string[]; whatsapp: string[] }> = [
  {
    intent: "POSITIVE",
    weight: 26,
    email: [
      "Hi, this sounds interesting. Can you tell me a bit more about how it would work for us?",
      "Thanks for reaching out — we have been meaning to look into this. Please send me more details.",
    ],
    whatsapp: ["Sounds interesting, tell me more", "Yes please send details"],
  },
  {
    intent: "MEETING_REQUEST",
    weight: 18,
    email: ["Sure, happy to talk. Would Thursday afternoon work for a quick call?", "Let's talk — I'm free on Tuesday after 3pm."],
    whatsapp: ["Can we talk on Friday? Afternoon works", "Call me tomorrow around 4"],
  },
  {
    intent: "PRICING_REQUEST",
    weight: 15,
    email: ["What would this cost for us? We have two outlets.", "Can you share your pricing for a three-month engagement?"],
    whatsapp: ["What's the price for this?", "How much per month?"],
  },
  {
    intent: "NOT_NOW",
    weight: 13,
    email: ["Thanks, but we're busy until after Diwali. Maybe next month?", "Not right now — could you circle back next quarter?"],
    whatsapp: ["Maybe later, busy season right now", "Next month please"],
  },
  {
    intent: "QUESTION",
    weight: 10,
    email: ["Do you already work with other businesses in our area?", "Is this something you handle in-house or through partners?"],
    whatsapp: ["Do you work with other cafés nearby?"],
  },
  { intent: "NEGATIVE", weight: 9, email: ["We're all set on this, thank you.", "We're good for now, thanks."], whatsapp: ["We're good, thanks"] },
  { intent: "OPT_OUT", weight: 5, email: ["Please remove me from your list."], whatsapp: ["Stop messaging please"] },
  { intent: "OUT_OF_OFFICE", weight: 4, email: ["I'm out of office until Monday and will reply when I'm back."], whatsapp: [] },
];

function pickReply(seed: string, channel: "EMAIL" | "WHATSAPP"): string {
  const options = REPLIES.filter((reply) => (channel === "EMAIL" ? reply.email : reply.whatsapp).length);
  const total = options.reduce((sum, reply) => sum + reply.weight, 0);
  let roll = unit(`${seed}:intent`) * total;
  for (const reply of options) {
    roll -= reply.weight;
    if (roll <= 0) {
      const texts = channel === "EMAIL" ? reply.email : reply.whatsapp;
      return texts[Math.floor(unit(`${seed}:text`) * texts.length)] ?? texts[0] ?? "";
    }
  }
  return options[0]?.email[0] ?? "";
}

// ----------------------------------------------------------------------------- Segments & campaigns

interface SegmentPlan {
  key: string;
  query: string;
  category: string;
  city: string;
  limit: number;
  discoveredDaysAgo: number;
  campaign: {
    name: string;
    description: string;
    automationMode: "ASSISTED" | "AUTOMATED";
    channels: Channel[];
    offerSummary: string;
    pitchAngle: string;
    launchedDaysAgo: number;
    completedDaysAgo?: number;
    minScore: number;
    steps: Array<CampaignStepInput & { template?: string }>;
    /** Members left untouched so the review queue has fresh AI drafts. */
    pendingDrafts: number;
  };
}

const SEGMENTS: SegmentPlan[] = [
  {
    key: "delhi-cafes",
    query: "Cafés in Delhi",
    category: "cafe",
    city: "Delhi",
    limit: 40,
    discoveredDaysAgo: 24,
    campaign: {
      name: "Delhi Cafés — social media",
      description: "Book 10 discovery calls with independent cafés",
      automationMode: "ASSISTED",
      channels: ["EMAIL", "WHATSAPP"],
      offerSummary: "Social media management for cafés: 12 posts and 8 reels a month, plus community management.",
      pitchAngle: "Regulars already post about you — we turn that into a steady content engine.",
      launchedDaysAgo: 21,
      minScore: 40,
      pendingDrafts: 4,
      steps: [
        {
          channel: "EMAIL",
          delayDays: 0,
          condition: "ALWAYS",
          name: "Opener",
          subject: "Quick idea for {{business_name}}",
          body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}",
          useAI: true,
        },
        { channel: "WHATSAPP", delayDays: 3, condition: "NO_REPLY", name: "WhatsApp nudge", subject: null, body: "Hi {{first_name}}, {{follow_up_hook}}", useAI: true, template: "gentle_follow_up" },
        {
          channel: "EMAIL",
          delayDays: 4,
          condition: "NO_REPLY",
          name: "Final nudge",
          subject: "Should I close the loop?",
          body: "Hi {{first_name}}, I don't want to crowd your inbox. If {{offer_short}} isn't a priority right now, no problem — just let me know and I won't follow up again.",
          useAI: true,
        },
      ],
    },
  },
  {
    key: "gurgaon-startups",
    query: "Startups in Gurgaon",
    category: "startup",
    city: "Gurgaon",
    limit: 18,
    discoveredDaysAgo: 17,
    campaign: {
      name: "Gurgaon Startups — websites",
      description: "Website rebuilds for seed-stage startups",
      automationMode: "AUTOMATED",
      channels: ["EMAIL"],
      offerSummary: "Conversion-focused websites for startups, live in four weeks.",
      pitchAngle: "Your product moved faster than your website.",
      launchedDaysAgo: 14,
      minScore: 45,
      pendingDrafts: 0,
      steps: [
        {
          channel: "EMAIL",
          delayDays: 0,
          condition: "ALWAYS",
          name: "Opener",
          subject: "{{business_name}}'s website",
          body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}",
          useAI: true,
        },
        {
          channel: "EMAIL",
          delayDays: 3,
          condition: "NO_REPLY",
          name: "Follow-up",
          subject: "Re: {{business_name}}'s website",
          body: "Hi {{first_name}}, following up on my note — {{follow_up_hook}}. Would a quick call this week be useful?",
          useAI: true,
        },
        {
          channel: "EMAIL",
          delayDays: 5,
          condition: "NO_REPLY",
          name: "Final nudge",
          subject: "Should I close the loop?",
          body: "Hi {{first_name}}, if {{offer_short}} isn't on the roadmap right now, no problem — let me know and I won't follow up again.",
          useAI: true,
        },
      ],
    },
  },
  {
    key: "noida-d2c",
    query: "D2C brands in Noida",
    category: "d2c_brand",
    city: "Noida",
    limit: 16,
    discoveredDaysAgo: 44,
    campaign: {
      name: "Noida D2C Brands — performance ads",
      description: "Paid ads pilot for growing D2C brands",
      automationMode: "ASSISTED",
      channels: ["EMAIL"],
      offerSummary: "Meta and Google ads management for D2C brands, with weekly reporting.",
      pitchAngle: "Lower acquisition costs through better creative testing.",
      launchedDaysAgo: 40,
      completedDaysAgo: 6,
      minScore: 45,
      pendingDrafts: 0,
      steps: [
        {
          channel: "EMAIL",
          delayDays: 0,
          condition: "ALWAYS",
          name: "Opener",
          subject: "Ads for {{business_name}}",
          body: "Hi {{first_name}},\n\n{{personal_observation}}\n\n{{value_proposition}}\n\n{{call_to_action}}\n\n{{sender_name}}",
          useAI: true,
        },
        {
          channel: "EMAIL",
          delayDays: 4,
          condition: "NO_REPLY",
          name: "Follow-up",
          subject: "Re: Ads for {{business_name}}",
          body: "Hi {{first_name}}, {{follow_up_hook}}. Happy to share a short teardown of your current ads if useful.",
          useAI: true,
        },
      ],
    },
  },
];

// ----------------------------------------------------------------------------- Helpers

type LeadWithContacts = Lead & { contacts: Contact[] };

async function backdateLead(ctx: TenantContext, leadId: string, at: Date) {
  await ctx.db.lead.update({ where: { id: leadId }, data: { createdAt: at, lastActivityAt: at } });
  await ctx.db.leadScore.updateMany({ where: { leadId }, data: { createdAt: new Date(at.getTime() + 3 * 60_000) } });
  const events = await ctx.db.event.findMany({ where: { leadId }, select: { id: true, type: true } });
  for (const [index, event] of events.entries()) {
    await ctx.db.event.update({ where: { id: event.id }, data: { occurredAt: new Date(at.getTime() + index * 45_000) } });
  }
}

/** Discovered but not yet in any campaign — so the campaign builder has fresh leads to target. */
const UNTOUCHED_SEGMENT = { query: "Restaurants in Gurgaon", category: "restaurant", city: "Gurgaon", limit: 24, discoveredDaysAgo: 3 };

async function discoverSegment(ctx: TenantContext, segment: Pick<SegmentPlan, "query" | "category" | "city" | "limit" | "discoveredDaysAgo">): Promise<LeadWithContacts[]> {
  const city = matchCity(segment.city);
  const run = await startDiscovery(ctx, {
    query: segment.query,
    limit: segment.limit,
    criteria: {
      categories: [segment.category],
      locations: city ? [{ label: city.name, city: city.name, lat: city.lat, lng: city.lng }] : [],
      radiusKm: 25,
      requireContact: true,
    },
  });
  await executeDiscoveryRun(ctx, run.id);

  const discoveredAt = morning(segment.discoveredDaysAgo);
  await ctx.db.discoveryRun.update({ where: { id: run.id }, data: { createdAt: discoveredAt, startedAt: discoveredAt, completedAt: new Date(discoveredAt.getTime() + 40_000) } });
  await ctx.db.event.updateMany({
    where: { type: { in: ["discovery_started", "discovery_completed"] }, properties: { path: ["runId"], equals: run.id } },
    data: { occurredAt: discoveredAt },
  });
  const links = await ctx.db.discoveryRunLead.findMany({ where: { runId: run.id }, select: { leadId: true } });
  const leads = await ctx.db.lead.findMany({ where: { id: { in: links.map((link) => link.leadId) } }, include: { contacts: { where: { deletedAt: null } } } });
  for (const [index, lead] of leads.entries()) {
    await backdateLead(ctx, lead.id, new Date(discoveredAt.getTime() + index * 90_000));
  }
  return leads;
}

interface SendInput {
  campaignId: string;
  stepId: string;
  stepName: string;
  lead: LeadWithContacts;
  channel: "EMAIL" | "WHATSAPP";
  at: Date;
  subject: string | null;
  body: string;
  templateName?: string | null;
  templateParameters?: string[];
  personalization: string[];
  approvedById: string | null;
  from: string;
  periodStart: Date;
}

/** Writes a sent (mock-provider) message with its delivery/open events, like sendMessage + webhooks do. */
async function seedSentMessage(ctx: TenantContext, input: SendInput) {
  const now = Date.now();
  const email = input.channel === "EMAIL";
  const contact = primaryContact(input.lead.contacts, input.channel === "EMAIL" ? "EMAIL" : "WHATSAPP");
  const to = email ? (contact?.email ?? input.lead.email) : (contact?.whatsapp ?? contact?.phone ?? input.lead.phone);
  const conversation = await findOrCreateConversation(ctx, { leadId: input.lead.id, channel: input.channel, campaignId: input.campaignId, contactId: contact?.id ?? null, subject: input.subject });
  const id = randomUUID();
  const deliveredAt = new Date(input.at.getTime() + 4_000);
  const key = `${input.lead.name}:${input.stepName}`;
  const engaged = unit(`${key}:open`) < (email ? 0.64 : 0.86);
  const engagedAt = engaged ? new Date(input.at.getTime() + (0.3 + unit(`${key}:ot`) * 20) * HOUR) : null;
  const engagedVisible = engagedAt && engagedAt.getTime() < now ? engagedAt : null;

  await ctx.db.message.create({
    data: {
      id,
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: input.lead.id,
      campaignId: input.campaignId,
      campaignStepId: input.stepId,
      channel: input.channel,
      direction: "OUTBOUND",
      status: email ? "DELIVERED" : engagedVisible ? "READ" : "DELIVERED",
      subject: input.subject,
      body: input.body,
      fromAddress: email ? input.from : null,
      toAddress: to,
      provider: "mock",
      providerMessageId: `mock_seed_${id}`,
      internetMessageId: email ? `<${id}@mock.local>` : null,
      templateName: input.templateName ?? null,
      generatedByAI: !input.templateName,
      scheduledFor: input.at,
      sentAt: input.at,
      deliveredAt,
      openedAt: email ? engagedVisible : null,
      readAt: email ? null : engagedVisible,
      approvedById: input.approvedById,
      approvedAt: input.approvedById ? new Date(input.at.getTime() - 25 * 60_000) : null,
      metadata: { simulated: true, personalization: input.personalization, ...(input.templateParameters ? { templateParameters: input.templateParameters, templateLanguage: "en" } : {}) } as Prisma.InputJsonValue,
      createdAt: new Date(input.at.getTime() - 40 * 60_000),
    },
  });
  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: input.at, status: "AWAITING_REPLY", subject: conversation.subject ?? input.subject },
  });

  const base = { leadId: input.lead.id, campaignId: input.campaignId, messageId: id, conversationId: conversation.id, channel: input.channel } as const;
  await recordEvent(ctx, { ...base, type: email ? "email_sent" : "whatsapp_sent", occurredAt: input.at, properties: { step: input.stepName, provider: "mock", simulated: true, template: input.templateName ?? null }, idempotencyKey: `sent:${id}` });
  await recordEvent(ctx, { ...base, type: email ? "email_delivered" : "whatsapp_delivered", occurredAt: deliveredAt, actor: { type: "PROVIDER", id: "mock" }, properties: { simulated: true } });
  if (engagedVisible) {
    await recordEvent(ctx, { ...base, type: email ? "email_opened" : "whatsapp_read", occurredAt: engagedVisible, actor: { type: "PROVIDER", id: "mock" }, properties: { simulated: true } });
  }
  if (input.at >= input.periodStart) {
    await consumeUsage(ctx, email ? "EMAIL_SENDS" : "WHATSAPP_MESSAGES", 1, { sourceType: "message", sourceId: id, campaignId: input.campaignId, idempotencyKey: `send:${id}` });
  }
  return { id, conversationId: conversation.id, engagedAt: engagedVisible ?? engagedAt, to };
}

async function setLeadStatus(ctx: TenantContext, lead: { id: string; status: string }, to: string, toLabel: string, reason: string, at: Date) {
  if (lead.status === to) return;
  await ctx.db.lead.update({ where: { id: lead.id }, data: { status: to as Lead["status"] } });
  await recordEvent(ctx, { type: "lead_status_changed", leadId: lead.id, occurredAt: at, properties: { from: lead.status, to, toLabel, reason } });
  lead.status = to;
}

// ----------------------------------------------------------------------------- Main

export async function seedDemoOutreach(ctx: TenantContext) {
  const { from } = await resolveEmailProvider(ctx);
  await syncWhatsAppTemplates(ctx);
  const templates = await ctx.db.whatsAppTemplate.findMany();
  const plan = await ctx.db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organizationId }, select: { currentPeriodStart: true } });
  const compliance = await ctx.db.complianceSettings.findFirst();
  const now = Date.now();
  const summary: Array<{ campaign: string; leads: number; sent: number; replies: number; drafts: number }> = [];

  for (const segment of SEGMENTS) {
    const discovered = await discoverSegment(ctx, segment);
    const spec = segment.campaign;
    const eligible = discovered
      .filter((lead) => (lead.score ?? 0) >= spec.minScore && !lead.doNotContact && (lead.email || lead.contacts.some((contact) => contact.email)))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Recorded WhatsApp opt-ins (e.g. from a website chat widget) for part of the audience.
    if (spec.channels.includes("WHATSAPP")) {
      for (const lead of eligible) {
        const contact = primaryContact(lead.contacts, "WHATSAPP");
        if (contact && unit(`${lead.name}:optin`) < 0.55) {
          const optedAt = new Date(lead.createdAt.getTime() + DAY);
          await ctx.db.contact.update({ where: { id: contact.id }, data: { whatsappOptIn: true, whatsappOptInAt: optedAt } });
          contact.whatsappOptIn = true;
        }
      }
    }

    const template = templates.find((item) => item.name === "gentle_follow_up");
    const campaign = await createCampaign(ctx, {
      name: spec.name,
      description: spec.description,
      automationMode: spec.automationMode,
      target: {
        categories: [segment.category],
        locations: [{ label: matchCity(segment.city)?.name ?? segment.city, city: matchCity(segment.city)?.name ?? segment.city }],
      },
      offerSummary: spec.offerSummary,
      pitchAngle: spec.pitchAngle,
      tone: "friendly",
      channels: spec.channels,
      minLeadScore: spec.minScore,
      steps: spec.steps.map(({ template: templateName, ...step }) => ({ ...step, whatsappTemplateId: templateName ? (template?.id ?? null) : null })),
    });
    const createdAt = new Date(morning(spec.launchedDaysAgo).getTime() - 26 * HOUR);
    const launchedAt = morning(spec.launchedDaysAgo);
    await addLeadsToCampaign(ctx, campaign.id, eligible.map((lead) => lead.id));
    await ctx.db.campaignLead.updateMany({ where: { campaignId: campaign.id }, data: { addedAt: createdAt } });
    await ctx.db.event.updateMany({ where: { campaignId: campaign.id, type: { in: ["campaign_created", "lead_added_to_campaign"] } }, data: { occurredAt: createdAt } });
    await ctx.db.campaign.update({
      where: { id: campaign.id },
      data: {
        createdAt,
        status: spec.completedDaysAgo ? "COMPLETED" : "ACTIVE",
        launchedAt,
        launchedById: ctx.userId,
        completedAt: spec.completedDaysAgo ? morning(spec.completedDaysAgo) : null,
      },
    });
    await recordEvent(ctx, { type: "campaign_started", campaignId: campaign.id, occurredAt: launchedAt, properties: { audience: eligible.length, mode: spec.automationMode, channels: spec.channels } });

    const steps = await ctx.db.campaignStep.findMany({ where: { campaignId: campaign.id }, orderBy: { order: "asc" } });
    const seller = await sellerContext(ctx, { offer: spec.offerSummary, pitchAngle: spec.pitchAngle });
    const members = await ctx.db.campaignLead.findMany({ where: { campaignId: campaign.id } });
    const byLead = new Map(eligible.map((lead) => [lead.id, lead]));
    const history = members.slice(0, Math.max(0, members.length - spec.pendingDrafts));
    const drafts = members.slice(history.length);
    let sent = 0;
    let replies = 0;

    for (const [index, member] of history.entries()) {
      const lead = byLead.get(member.leadId);
      if (!lead) continue;
      const leadState = { id: lead.id, status: lead.status as string };
      let at = new Date(launchedAt.getTime() + index * 23 * 60_000);
      let replied = false;
      let lastStepAt: Date | null = null;
      let nextStepOrder = 0;
      const previous: Array<{ direction: "OUTBOUND" | "INBOUND"; body: string }> = [];

      for (const step of steps) {
        if (step.order > 0) at = new Date(at.getTime() + step.delayDays * DAY);
        if (at.getTime() > now) break;
        if (step.channel !== "EMAIL" && step.channel !== "WHATSAPP") continue;
        nextStepOrder = step.order + 1;
        const channel = step.channel;
        const contact = primaryContact(lead.contacts, channel);
        if (channel === "WHATSAPP" && !contact?.whatsappOptIn) continue; // the engine skips the step without opt-in

        const composed = composeOutreachMessage({
          channel,
          stepName: step.name,
          stepOrder: step.order,
          template: { subject: step.subject, body: step.body },
          tone: "friendly",
          lead: leadContext(lead),
          seller,
          previousMessages: previous.map((message) => ({ ...message, channel })),
        });
        let body = composed.body;
        let templateParameters: string[] | undefined;
        if (channel === "WHATSAPP" && template) {
          const values: Record<string, string> = { first_name: leadContext(lead).contactName?.split(" ")[0] ?? "there", offer_short: seller.offer ?? "" };
          templateParameters = template.variables.map((name) => values[name] ?? "");
          body = template.body.replace(/\{\{(\d+)\}\}/g, (_, position: string) => templateParameters?.[Number(position) - 1] ?? "");
        }
        const message = await seedSentMessage(ctx, {
          campaignId: campaign.id,
          stepId: step.id,
          stepName: step.name,
          lead,
          channel,
          at,
          subject: channel === "EMAIL" ? composed.subject : null,
          body,
          templateName: channel === "WHATSAPP" ? (template?.name ?? null) : null,
          templateParameters,
          personalization: composed.personalization,
          approvedById: spec.automationMode === "ASSISTED" || step.order === 0 ? ctx.userId : null,
          from,
          periodStart: plan.currentPeriodStart,
        });
        sent += 1;
        lastStepAt = at;
        previous.push({ direction: "OUTBOUND", body });
        if (step.order === 0) await setLeadStatus(ctx, leadState, "CONTACTED", "Contacted", "First outreach sent", at);

        // Replies come from people who opened/read, a few hours to two days later.
        const replyRoll = unit(`${lead.name}:${step.order}:reply`);
        if (!message.engagedAt || replyRoll > (step.order === 0 ? 0.3 : 0.2)) continue;
        const replyAt = new Date(message.engagedAt.getTime() + (1 + unit(`${lead.name}:rt`) * 40) * HOUR);
        if (replyAt.getTime() > now - 10 * 60_000) continue;
        const text = pickReply(`${lead.name}:${step.order}`, channel);
        const analysis = analyzeConversationDeterministically({
          channel,
          leadName: lead.name,
          sellerName: seller.businessName,
          offer: seller.offer,
          messages: [...previous, { direction: "INBOUND", body: text }],
          optOutKeywords: compliance?.optOutKeywords ?? ["stop", "unsubscribe", "remove me"],
          pricingFacts: [],
        });
        const inboundId = randomUUID();
        const recent = now - replyAt.getTime() < 5 * DAY;
        await ctx.db.message.create({
          data: {
            id: inboundId,
            organizationId: ctx.organizationId,
            conversationId: message.conversationId,
            leadId: lead.id,
            campaignId: campaign.id,
            channel,
            direction: "INBOUND",
            status: "RECEIVED",
            subject: channel === "EMAIL" && composed.subject ? `Re: ${composed.subject}` : null,
            body: text,
            fromAddress: message.to,
            provider: "mock",
            providerMessageId: `mock_seed_in_${inboundId}`,
            inReplyTo: channel === "EMAIL" ? `<${message.id}@mock.local>` : null,
            intent: analysis.intent,
            sentiment: analysis.sentiment,
            metadata: { simulated: true } as Prisma.InputJsonValue,
            createdAt: replyAt,
          },
        });
        const answered = !recent && ["POSITIVE", "MEETING_REQUEST", "PRICING_REQUEST", "QUESTION"].includes(analysis.intent);
        await ctx.db.conversation.update({
          where: { id: message.conversationId },
          data: {
            lastMessageAt: replyAt,
            lastInboundAt: replyAt,
            unreadCount: recent ? 1 : 0,
            status: analysis.optOut ? "CLOSED" : answered ? "AWAITING_REPLY" : recent ? "NEEDS_RESPONSE" : "OPEN",
            aiIntent: analysis.intent,
            aiSentiment: analysis.sentiment,
            aiSummary: analysis.summary,
            suggestedReply: answered ? null : analysis.suggestedReply,
          },
        });
        const replyBase = { leadId: lead.id, campaignId: campaign.id, conversationId: message.conversationId, messageId: inboundId, channel } as const;
        await recordEvent(ctx, { ...replyBase, type: channel === "EMAIL" ? "email_replied" : "whatsapp_received", occurredAt: replyAt, actor: { type: "PROVIDER", id: "mock" }, properties: { simulated: true } });
        await recordEvent(ctx, { ...replyBase, type: "reply_classified", occurredAt: new Date(replyAt.getTime() + 30_000), actor: { type: "AI" }, properties: { intent: analysis.intent, sentiment: analysis.sentiment, simulated: true } });
        await recordEvent(ctx, { type: "sequence_stopped", leadId: lead.id, campaignId: campaign.id, occurredAt: new Date(replyAt.getTime() + 30_000), properties: { reason: "Lead replied" } });
        replies += 1;
        replied = true;
        lastStepAt = replyAt;
        await setLeadStatus(ctx, leadState, "REPLIED", "Replied", "Inbound reply", replyAt);

        if (analysis.optOut) {
          await addSuppression(ctx, { leadId: lead.id, email: channel === "EMAIL" ? message.to : null, phone: channel === "WHATSAPP" ? message.to : null }, { reason: "OPT_OUT", sourceType: "reply", sourceId: inboundId });
          await recordEvent(ctx, { ...replyBase, type: "opt_out", occurredAt: new Date(replyAt.getTime() + 45_000), properties: { source: "reply" } });
          await ctx.db.campaignLead.update({ where: { id: member.id }, data: { status: "OPTED_OUT", stoppedReason: "Asked not to be contacted", nextActionAt: null, lastStepAt, nextStepOrder } });
          break;
        }
        if (["POSITIVE", "MEETING_REQUEST", "PRICING_REQUEST"].includes(analysis.intent)) {
          await setLeadStatus(ctx, leadState, "INTERESTED", "Interested", `Reply classified as ${analysis.intent.toLowerCase().replace(/_/g, " ")}`, new Date(replyAt.getTime() + 40_000));
        }
        if (answered) {
          const answerAt = new Date(replyAt.getTime() + (2 + unit(`${lead.name}:ans`) * 5) * HOUR);
          const answer =
            analysis.intent === "MEETING_REQUEST"
              ? "That works — I've sent a calendar invite. Looking forward to it!"
              : analysis.intent === "PRICING_REQUEST"
                ? "Thanks for asking! It depends on scope — could we do a 15-minute call so I can share an accurate quote?"
                : "Thanks for getting back to me! Would a short call this week be easiest? I can walk you through a couple of examples.";
          const answerId = randomUUID();
          await ctx.db.message.create({
            data: {
              id: answerId,
              organizationId: ctx.organizationId,
              conversationId: message.conversationId,
              leadId: lead.id,
              campaignId: campaign.id,
              channel,
              direction: "OUTBOUND",
              status: "DELIVERED",
              subject: channel === "EMAIL" && composed.subject ? `Re: ${composed.subject}` : null,
              body: answer,
              fromAddress: channel === "EMAIL" ? from : null,
              toAddress: message.to,
              provider: "mock",
              providerMessageId: `mock_seed_${answerId}`,
              sentAt: answerAt,
              deliveredAt: new Date(answerAt.getTime() + 4_000),
              approvedById: ctx.userId,
              approvedAt: answerAt,
              createdById: ctx.userId,
              metadata: { manual: true, simulated: true } as Prisma.InputJsonValue,
              createdAt: answerAt,
            },
          });
          await ctx.db.conversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: answerAt } });
          await recordEvent(ctx, { ...replyBase, messageId: answerId, type: channel === "EMAIL" ? "email_sent" : "whatsapp_sent", occurredAt: answerAt, properties: { manual: true, simulated: true } });
          await recordEvent(ctx, {
            ...replyBase,
            messageId: answerId,
            type: channel === "EMAIL" ? "email_delivered" : "whatsapp_delivered",
            occurredAt: new Date(answerAt.getTime() + 4_000),
            actor: { type: "PROVIDER", id: "mock" },
            properties: { simulated: true },
          });
        }
        if (analysis.intent === "MEETING_REQUEST") {
          const scheduledAt = new Date(Math.max(replyAt.getTime() + 2 * DAY, now + (1 + unit(`${lead.name}:mt`) * 5) * DAY));
          scheduledAt.setUTCHours(9, 30, 0, 0);
          const meeting = await ctx.db.meeting.create({
            data: { organizationId: ctx.organizationId, leadId: lead.id, title: `Intro call — ${lead.name}`, scheduledAt, durationMinutes: 30, location: "Google Meet", source: channel.toLowerCase(), sourceId: inboundId, createdById: ctx.userId, createdAt: replyAt },
          });
          await recordEvent(ctx, { type: "meeting_created", leadId: lead.id, campaignId: campaign.id, occurredAt: new Date(replyAt.getTime() + 3 * HOUR), properties: { meetingId: meeting.id, scheduledAt: scheduledAt.toISOString() } });
          await setLeadStatus(ctx, leadState, "MEETING", "Meeting", "Meeting booked from reply", new Date(replyAt.getTime() + 3 * HOUR));
        } else if (analysis.intent === "NOT_NOW") {
          await ctx.db.task.create({
            data: { organizationId: ctx.organizationId, leadId: lead.id, title: `Follow up with ${lead.name}`, description: `They asked to reconnect later: “${text}”`, type: "FOLLOW_UP", priority: "MEDIUM", dueAt: new Date(replyAt.getTime() + 30 * DAY), assigneeId: ctx.userId, createdById: ctx.userId, createdAt: replyAt },
          });
        }
        await ctx.db.campaignLead.update({ where: { id: member.id }, data: { status: "REPLIED", stoppedReason: "Lead replied", nextActionAt: null, lastStepAt, nextStepOrder } });
        break;
      }

      if (replied) continue;
      const nextStep = steps.find((step) => step.order === nextStepOrder);
      if (spec.completedDaysAgo || !nextStep) {
        await ctx.db.campaignLead.update({ where: { id: member.id }, data: { status: "COMPLETED", nextActionAt: null, lastStepAt, nextStepOrder, stoppedReason: spec.completedDaysAgo ? "Campaign completed" : null } });
      } else {
        await ctx.db.campaignLead.update({
          where: { id: member.id },
          data: { status: "IN_SEQUENCE", lastStepAt, nextStepOrder, nextActionAt: new Date(Math.max(at.getTime(), now + (1 + unit(`${lead.name}:next`) * 3) * DAY)) },
        });
      }
    }

    // Fresh AI drafts waiting for review (Assisted mode) — prepared by the real sequence engine.
    for (const member of drafts) {
      await ctx.db.campaignLead.update({ where: { id: member.id }, data: { status: "IN_SEQUENCE", nextStepOrder: 0, nextActionAt: new Date() } });
      await prepareCampaignStep(ctx, member.id);
    }
    if (spec.completedDaysAgo) {
      await recordEvent(ctx, { type: "campaign_completed", campaignId: campaign.id, occurredAt: morning(spec.completedDaysAgo) });
    }
    summary.push({ campaign: spec.name, leads: members.length, sent, replies, drafts: drafts.length });
  }
  const fresh = await discoverSegment(ctx, UNTOUCHED_SEGMENT);
  summary.push({ campaign: `(no campaign) ${UNTOUCHED_SEGMENT.query}`, leads: fresh.length, sent: 0, replies: 0, drafts: 0 });
  return summary;
}
