import { renderTemplate } from "../shared/text";
import { getQueue } from "@repo/queue";
import type { CampaignStep, Prisma } from "@repo/db";
import { composeOutreachMessage, outreachMessageAgent, type OutreachMessage } from "../ai/agents/outreach";
import { runAgent } from "../ai/service";
import type { TenantContext } from "../context";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { leadContext, primaryContact, sellerContext } from "./context";
import { findOrCreateConversation, whatsappWindowOpen } from "./conversations";
import { assertCanContact, nextSendWindow, OutreachBlockedError, quietHoursSchema } from "./policy";
import { resolveEmailProvider, resolveWhatsAppProvider } from "./providers";

/**
 * Sequence engine. A CampaignLead walks through its campaign's steps:
 *   prepareCampaignStep → Message (DRAFT / PENDING_APPROVAL / APPROVED by automation mode)
 *   → sendMessage → advanceSequence (schedules the next step after its delay)
 * A reply, opt-out, pause or completion stops the walk.
 */

const ACTIVE_STATES = ["IN_SEQUENCE"] as const;

/** Moves a campaign lead to its next step (or completes it) after a step finished. */
export async function advanceSequence(ctx: TenantContext, campaignLeadId: string, from: Date = new Date()) {
  const campaignLead = await ctx.db.campaignLead.findFirst({ where: { id: campaignLeadId }, include: { campaign: { include: { steps: { orderBy: { order: "asc" } } } } } });
  if (!campaignLead) return;
  if (["REPLIED", "OPTED_OUT", "STOPPED", "COMPLETED"].includes(campaignLead.status)) return;
  const nextOrder = campaignLead.nextStepOrder + 1;
  const next = campaignLead.campaign.steps.find((step) => step.order === nextOrder);
  if (!next) {
    await ctx.db.campaignLead.update({ where: { id: campaignLeadId }, data: { status: "COMPLETED", nextStepOrder: nextOrder, nextActionAt: null, lastStepAt: from } });
    return;
  }
  await ctx.db.campaignLead.update({
    where: { id: campaignLeadId },
    data: { status: "IN_SEQUENCE", nextStepOrder: nextOrder, lastStepAt: from, nextActionAt: new Date(from.getTime() + next.delayDays * 86_400_000) },
  });
}

async function stopCampaignLead(ctx: TenantContext, campaignLeadId: string, status: "OPTED_OUT" | "STOPPED" | "FAILED", reason: string, leadId: string, campaignId: string) {
  await ctx.db.campaignLead.update({ where: { id: campaignLeadId }, data: { status, stoppedReason: reason, nextActionAt: null } });
  await recordEvent(ctx, { type: "sequence_stopped", leadId, campaignId, properties: { reason } });
}

/** Parameters for an approved WhatsApp template, filled from the same variables as email templates. */
function templateParameters(variables: string[], values: Record<string, string>): string[] {
  return variables.map((name) => values[name] ?? "");
}

export interface PrepareResult {
  status: "created" | "skipped" | "stopped" | "task" | "waiting";
  messageId?: string;
  reason?: string;
}

export async function prepareCampaignStep(ctx: TenantContext, campaignLeadId: string): Promise<PrepareResult> {
  const campaignLead = await ctx.db.campaignLead.findFirst({
    where: { id: campaignLeadId },
    include: {
      campaign: { include: { steps: { orderBy: { order: "asc" }, include: { whatsappTemplate: true } } } },
      lead: { include: { contacts: { where: { deletedAt: null } } } },
    },
  });
  if (!campaignLead) return { status: "skipped", reason: "not found" };
  const { campaign, lead } = campaignLead;
  if (campaign.status !== "ACTIVE") return { status: "waiting", reason: `campaign ${campaign.status.toLowerCase()}` };
  if (!ACTIVE_STATES.includes(campaignLead.status as (typeof ACTIVE_STATES)[number])) return { status: "skipped", reason: campaignLead.status };

  const step = campaign.steps.find((item) => item.order === campaignLead.nextStepOrder);
  if (!step) {
    await ctx.db.campaignLead.update({ where: { id: campaignLead.id }, data: { status: "COMPLETED", nextActionAt: null } });
    return { status: "skipped", reason: "sequence complete" };
  }

  // Don't prepare the same step twice (job retries, overlapping ticks).
  const existing = await ctx.db.message.findFirst({ where: { campaignStepId: step.id, leadId: lead.id, status: { notIn: ["CANCELED", "FAILED"] } }, select: { id: true } });
  if (existing) return { status: "skipped", reason: "already prepared", messageId: existing.id };

  if (step.channel === "MANUAL_CALL" || step.channel === "VOICE") {
    return prepareCallStep(ctx, campaignLead.id, step, lead.id, lead.name, campaign.id);
  }

  const channel = step.channel;
  const contact = primaryContact(lead.contacts, channel === "EMAIL" ? "EMAIL" : "WHATSAPP");
  const address = channel === "EMAIL" ? (contact?.email ?? lead.email) : (contact?.whatsapp ?? contact?.phone ?? lead.phone);
  const conversation = await findOrCreateConversation(ctx, { leadId: lead.id, channel, campaignId: campaign.id, contactId: contact?.id ?? null });

  let providerIsMock: boolean;
  try {
    providerIsMock = channel === "EMAIL" ? (await resolveEmailProvider(ctx)).provider.isMock : (await resolveWhatsAppProvider(ctx)).isMock;
    await assertCanContact(
      ctx,
      {
        leadId: lead.id,
        doNotContact: lead.doNotContact,
        sourceProvider: lead.sourceProvider,
        email: channel === "EMAIL" ? address : null,
        phone: channel === "WHATSAPP" ? address : null,
        whatsappOptIn: Boolean(contact?.whatsappOptIn) || whatsappWindowOpen(conversation.lastInboundAt),
      },
      { channel, campaignId: campaign.id, providerIsMock },
    );
  } catch (error) {
    if (error instanceof OutreachBlockedError) {
      if (error.reason === "NO_CONTACT_DETAIL" || error.reason === "WHATSAPP_NO_OPT_IN") {
        // This channel can't be used for this lead — skip the step, keep the sequence going.
        await recordEvent(ctx, { type: "sequence_stopped", leadId: lead.id, campaignId: campaign.id, channel, properties: { step: step.name, skipped: true, reason: error.message } });
        await advanceSequence(ctx, campaignLead.id);
        return { status: "skipped", reason: error.message };
      }
      await stopCampaignLead(ctx, campaignLead.id, error.reason === "SUPPRESSED" || error.reason === "DO_NOT_CONTACT" ? "OPTED_OUT" : "STOPPED", error.message, lead.id, campaign.id);
      return { status: "stopped", reason: error.message };
    }
    throw error;
  }

  const seller = await sellerContext(ctx, { offer: campaign.offerSummary, pitchAngle: campaign.pitchAngle, offeringIds: campaign.offeringIds });
  const previous = await ctx.db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, take: 6, select: { direction: true, channel: true, body: true } });
  const agentInput = {
    channel,
    stepName: step.name,
    stepOrder: step.order,
    template: { subject: step.subject, body: step.body },
    tone: campaign.tone,
    lead: leadContext(lead),
    seller,
    previousMessages: previous.map((message) => ({ direction: message.direction, channel: message.channel, body: message.body.slice(0, 500) })),
  } as const;

  let content: OutreachMessage;
  let aiRequestId: string | null = null;
  let templateName: string | null = null;
  let metadata: Record<string, unknown> = {};

  const businessInitiatedWhatsApp = channel === "WHATSAPP" && !whatsappWindowOpen(conversation.lastInboundAt);
  if (businessInitiatedWhatsApp) {
    const template = step.whatsappTemplate;
    if (!template || template.status !== "APPROVED") {
      await recordEvent(ctx, { type: "sequence_stopped", leadId: lead.id, campaignId: campaign.id, channel, properties: { step: step.name, skipped: true, reason: "No approved WhatsApp template" } });
      await advanceSequence(ctx, campaignLead.id);
      return { status: "skipped", reason: "No approved WhatsApp template for this step" };
    }
    const values = composeOutreachMessage(agentInput);
    const variables: Record<string, string> = {
      first_name: agentInput.lead.contactName?.split(" ")[0] ?? "there",
      business_name: lead.name,
      sender_name: seller.senderName,
      sender_company: seller.businessName,
      offer_short: seller.offer ?? "",
      locality: lead.locality ?? lead.city ?? "",
      call_to_action: values.callToAction,
    };
    const parameters = templateParameters(template.variables, variables);
    content = {
      subject: null,
      body: renderTemplate(template.body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => `{{p${index}}}`), Object.fromEntries(parameters.map((value, index) => [`p${index + 1}`, value]))),
      personalization: values.personalization,
      callToAction: values.callToAction,
    };
    templateName = template.name;
    metadata = { templateLanguage: template.language, templateParameters: parameters };
  } else if (step.useAI) {
    const { output, meta } = await runAgent(ctx, outreachMessageAgent, agentInput, { leadId: lead.id, campaignId: campaign.id });
    content = output;
    aiRequestId = meta.aiRequestId;
  } else {
    content = composeOutreachMessage(agentInput);
  }

  const compliance = await ctx.db.complianceSettings.findFirst();
  const needsApproval =
    campaign.automationMode === "ASSISTED" || (campaign.automationMode === "AUTOMATED" && step.order === 0 && (compliance?.requireApprovalFirstTouch ?? true));
  const status = campaign.automationMode === "MANUAL" ? "DRAFT" : needsApproval ? "PENDING_APPROVAL" : "APPROVED";

  const org = await ctx.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
  const window = quietHoursSchema.parse(compliance?.quietHours ?? {});
  const scheduledFor = status === "APPROVED" ? nextSendWindow(new Date(), org?.timezone ?? "UTC", window) : null;

  const message = await ctx.db.message.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      leadId: lead.id,
      campaignId: campaign.id,
      campaignStepId: step.id,
      channel,
      direction: "OUTBOUND",
      status,
      subject: content.subject,
      body: content.body,
      toAddress: address,
      templateName,
      generatedByAI: Boolean(aiRequestId),
      aiRequestId,
      scheduledFor,
      metadata: { ...metadata, personalization: content.personalization, simulated: providerIsMock } as Prisma.InputJsonValue,
    },
  });
  await ctx.db.campaignLead.update({ where: { id: campaignLead.id }, data: { status: status === "APPROVED" ? "IN_SEQUENCE" : "AWAITING_APPROVAL", nextActionAt: null } });
  await recordEvent(ctx, {
    type: "outreach_generated",
    leadId: lead.id,
    campaignId: campaign.id,
    messageId: message.id,
    conversationId: conversation.id,
    channel,
    properties: { step: step.name, ai: Boolean(aiRequestId), status, template: templateName },
  });

  if (status === "APPROVED") {
    await getQueue().enqueue("messages.send", { organizationId: ctx.organizationId, messageId: message.id }, {
      jobId: `send:${message.id}`,
      delayMs: Math.max(0, (scheduledFor?.getTime() ?? Date.now()) - Date.now()),
    });
  }
  return { status: "created", messageId: message.id };
}

/** Registered by the calls module (AI voice agent); without it VOICE steps fall back to call tasks. */
export type VoiceStepHandler = (ctx: TenantContext, input: { leadId: string; campaignId: string; campaignLeadId: string; stepName: string }) => Promise<{ status: string }>;
let voiceStepHandler: VoiceStepHandler | null = null;
export function registerVoiceStepHandler(handler: VoiceStepHandler): void {
  voiceStepHandler = handler;
}

async function prepareCallStep(ctx: TenantContext, campaignLeadId: string, step: CampaignStep, leadId: string, leadName: string, campaignId: string): Promise<PrepareResult> {
  if (step.channel === "VOICE" && voiceStepHandler) {
    try {
      const call = await voiceStepHandler(ctx, { leadId, campaignId, campaignLeadId, stepName: step.name });
      return { status: "created", reason: `call ${call.status.toLowerCase()}` };
    } catch (error) {
      logger.warn({ err: error, leadId }, "AI call step could not be prepared; falling back to a manual call task");
    }
  }
  const { createTask } = await import("../crm/tasks");
  await createTask(ctx, {
    title: `Call ${leadName} (${step.name})`,
    description: step.body,
    type: "CALL",
    priority: "HIGH",
    dueAt: new Date(),
    leadId,
  });
  await advanceSequence(ctx, campaignLeadId);
  return { status: "task" };
}
