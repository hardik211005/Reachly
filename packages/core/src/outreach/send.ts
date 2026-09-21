import { getEnv } from "@repo/config/env";
import { IntegrationError } from "@repo/integrations";
import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { consumeUsage, isLimitError, releaseUsage } from "../billing/usage";
import type { TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { notify } from "../notifications";
import { whatsappWindowOpen } from "./conversations";
import { assertCanContact, nextSendWindow, OutreachBlockedError, quietHoursSchema, sentToday } from "./policy";
import { resolveEmailProvider, resolveWhatsAppProvider } from "./providers";
import { advanceSequence } from "./sequence";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

const SENDABLE = ["APPROVED", "QUEUED"] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function emailHtml(body: string, footer: string, unsubscribeLink: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a19">${paragraphs}<hr style="border:none;border-top:1px solid #e6e5e0;margin:24px 0 12px"><p style="font-size:12px;color:#7a7873;margin:0">${escapeHtml(footer)}<br><a href="${unsubscribeLink}" style="color:#7a7873">Unsubscribe</a></p></div>`;
}

export interface SendOutcome {
  status: "sent" | "rescheduled" | "blocked" | "skipped" | "failed";
  reason?: string;
}

/**
 * Sends one approved outbound message. All compliance, window, limit and usage checks
 * happen here — the last gate before anything leaves the platform.
 */
export async function sendMessage(ctx: TenantContext, messageId: string): Promise<SendOutcome> {
  const message = await ctx.db.message.findFirst({
    where: { id: messageId },
    include: {
      lead: { include: { contacts: { where: { deletedAt: null } } } },
      campaign: true,
      conversation: true,
      campaignStep: true,
    },
  });
  if (!message) throw new NotFoundError("Message", messageId);
  if (message.direction !== "OUTBOUND" || !SENDABLE.includes(message.status as (typeof SENDABLE)[number])) return { status: "skipped", reason: message.status };
  // Sequence messages wait for an active campaign; human replies in the thread always go.
  if (message.campaign && message.campaignStepId && message.campaign.status !== "ACTIVE") return { status: "skipped", reason: `campaign ${message.campaign.status.toLowerCase()}` };

  const [compliance, org] = await Promise.all([
    ctx.db.complianceSettings.findFirst(),
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true, name: true } }),
  ]);

  const channel = message.channel;
  if (channel !== "EMAIL" && channel !== "WHATSAPP") throw new PreconditionError(`Messages can't be sent on ${channel}`);

  // Campaign-driven automated sends respect the send window and daily limits.
  if (message.campaign && message.campaignStepId && message.campaign.automationMode === "AUTOMATED") {
    const window = quietHoursSchema.parse(compliance?.quietHours ?? {});
    const nextWindow = nextSendWindow(new Date(), org.timezone, window);
    const limits = (message.campaign.dailyLimits ?? {}) as Partial<Record<string, number>>;
    const limit = limits[channel];
    let deferUntil: Date | null = nextWindow.getTime() > Date.now() + 60_000 ? nextWindow : null;
    if (!deferUntil && limit !== undefined && (await sentToday(ctx, message.campaign.id, channel, org.timezone)) >= limit) {
      deferUntil = nextSendWindow(new Date(Date.now() + 12 * 3_600_000), org.timezone, window);
    }
    if (deferUntil) {
      await ctx.db.message.update({ where: { id: message.id }, data: { status: "QUEUED", scheduledFor: deferUntil } });
      await getQueue().enqueue("messages.send", { organizationId: ctx.organizationId, messageId: message.id }, { jobId: `send:${message.id}:${deferUntil.getTime()}`, delayMs: deferUntil.getTime() - Date.now() });
      return { status: "rescheduled", reason: `deferred to ${deferUntil.toISOString()}` };
    }
  }

  const resolved = channel === "EMAIL" ? await resolveEmailProvider(ctx) : null;
  const whatsapp = channel === "WHATSAPP" ? await resolveWhatsAppProvider(ctx) : null;
  const providerIsMock = resolved ? resolved.provider.isMock : Boolean(whatsapp?.isMock);
  const address = message.toAddress;
  const contact = message.lead.contacts.find((item) => item.email === address || item.phone === address || item.whatsapp === address);

  try {
    await assertCanContact(
      ctx,
      {
        leadId: message.leadId,
        doNotContact: message.lead.doNotContact,
        sourceProvider: message.lead.sourceProvider,
        email: channel === "EMAIL" ? address : null,
        phone: channel === "WHATSAPP" ? address : null,
        whatsappOptIn: Boolean(contact?.whatsappOptIn) || whatsappWindowOpen(message.conversation.lastInboundAt) || Boolean(message.templateName),
      },
      { channel, campaignId: message.campaignId, providerIsMock },
    );
    if (channel === "WHATSAPP" && !message.templateName && !whatsappWindowOpen(message.conversation.lastInboundAt)) {
      throw new OutreachBlockedError("WHATSAPP_NO_OPT_IN", "Free-form WhatsApp messages are only allowed within 24 hours of the customer's last message — use an approved template");
    }
  } catch (error) {
    if (error instanceof OutreachBlockedError) {
      await ctx.db.message.update({ where: { id: message.id }, data: { status: "SUPPRESSED", error: error.message } });
      await recordEvent(ctx, { type: "message_suppressed", leadId: message.leadId, campaignId: message.campaignId, messageId: message.id, channel, properties: { reason: error.reason } });
      return { status: "blocked", reason: error.message };
    }
    throw error;
  }

  const metric = channel === "EMAIL" ? "EMAIL_SENDS" : "WHATSAPP_MESSAGES";
  try {
    await consumeUsage(ctx, metric, 1, { sourceType: "message", sourceId: message.id, campaignId: message.campaignId, idempotencyKey: `send:${message.id}` });
  } catch (error) {
    if (isLimitError(error)) {
      await ctx.db.message.update({ where: { id: message.id }, data: { status: "FAILED", failedAt: new Date(), error: error.message } });
      await notify(ctx, { type: "credits.low", title: `Outreach paused: ${metric === "EMAIL_SENDS" ? "email" : "WhatsApp"} limit reached`, body: error.message, link: "/app/billing" });
      return { status: "failed", reason: error.message };
    }
    throw error;
  }

  await ctx.db.message.update({ where: { id: message.id }, data: { status: "SENDING" } });

  let providerMessageId: string;
  let internetMessageId: string | null = null;
  let fromAddress: string | null = null;
  try {
    if (resolved) {
      const email = address as string;
      const token = unsubscribeToken({ organizationId: ctx.organizationId, leadId: message.leadId, email, messageId: message.id, campaignId: message.campaignId });
      const link = unsubscribeUrl(token);
      const footer = [compliance?.emailFooter, compliance?.postalAddress].filter(Boolean).join(" · ") || org.name;
      const previousOutbound = await ctx.db.message.findFirst({
        where: { conversationId: message.conversationId, direction: "OUTBOUND", internetMessageId: { not: null }, id: { not: message.id } },
        orderBy: { sentAt: "desc" },
        select: { internetMessageId: true },
      });
      const text = `${message.body}\n\n--\n${footer}\nUnsubscribe: ${link}`;
      const result = await resolved.provider.send({
        from: resolved.from,
        to: email,
        replyTo: resolved.replyTo ?? undefined,
        subject: message.subject ?? `Message from ${org.name}`,
        text: compliance?.includeUnsubscribeLink === false ? message.body : text,
        html: emailHtml(message.body, footer, link),
        headers: {
          "List-Unsubscribe": `<${getEnv().APP_URL}/api/unsubscribe/${token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          ...(previousOutbound?.internetMessageId ? { "In-Reply-To": previousOutbound.internetMessageId, References: previousOutbound.internetMessageId } : {}),
        },
        tags: { message_id: message.id, organization_id: ctx.organizationId },
      });
      providerMessageId = result.providerMessageId;
      internetMessageId = result.internetMessageId ?? null;
      fromAddress = resolved.from;
    } else if (whatsapp) {
      const to = address as string;
      const metadata = (message.metadata ?? {}) as { templateLanguage?: string; templateParameters?: string[] };
      const result = message.templateName
        ? await whatsapp.sendTemplate({ to, templateName: message.templateName, language: metadata.templateLanguage ?? "en", parameters: metadata.templateParameters ?? [] })
        : await whatsapp.sendText({ to, body: message.body });
      providerMessageId = result.providerMessageId;
    } else {
      throw new PreconditionError("No provider");
    }
  } catch (error) {
    const retryable = error instanceof IntegrationError ? error.retryable : !(error instanceof PreconditionError);
    logger.warn({ err: error, messageId, retryable }, "provider send failed");
    if (retryable) {
      // Leave the message queued; the job retries with backoff (usage stays reserved by idempotency key).
      await ctx.db.message.update({ where: { id: message.id }, data: { status: "QUEUED", error: error instanceof Error ? error.message.slice(0, 300) : String(error) } });
      throw error;
    }
    await ctx.db.message.update({ where: { id: message.id }, data: { status: "FAILED", failedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 500) : String(error) } });
    await releaseUsage(ctx, metric, 1, "send_failed", message.id);
    await recordEvent(ctx, { type: channel === "EMAIL" ? "email_failed" : "whatsapp_failed", leadId: message.leadId, campaignId: message.campaignId, messageId: message.id, channel });
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  const sentAt = new Date();
  await ctx.db.message.update({
    where: { id: message.id },
    data: {
      status: "SENT",
      sentAt,
      provider: resolved?.provider.name ?? whatsapp?.name ?? null,
      providerMessageId,
      internetMessageId,
      fromAddress,
      error: null,
      metadata: { ...((message.metadata ?? {}) as Record<string, unknown>), simulated: providerIsMock } as Prisma.InputJsonValue,
    },
  });
  await ctx.db.conversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: sentAt, status: "AWAITING_REPLY", subject: message.conversation.subject ?? message.subject } });
  if (["NEW", "QUALIFIED"].includes(message.lead.status)) {
    await ctx.db.lead.update({ where: { id: message.leadId }, data: { status: "CONTACTED" } });
    await recordEvent(ctx, { type: "lead_status_changed", leadId: message.leadId, properties: { from: message.lead.status, to: "CONTACTED", fromLabel: message.lead.status === "NEW" ? "New" : "Qualified", toLabel: "Contacted", reason: "First outreach sent" } });
  }
  await recordEvent(ctx, {
    type: channel === "EMAIL" ? "email_sent" : "whatsapp_sent",
    occurredAt: sentAt,
    leadId: message.leadId,
    campaignId: message.campaignId,
    messageId: message.id,
    conversationId: message.conversationId,
    channel,
    properties: { step: message.campaignStep?.name ?? null, provider: resolved?.provider.name ?? whatsapp?.name, simulated: providerIsMock, template: message.templateName },
    idempotencyKey: `sent:${message.id}`,
  });

  if (message.campaignId && message.campaignStepId) {
    const campaignLead = await ctx.db.campaignLead.findFirst({ where: { campaignId: message.campaignId, leadId: message.leadId } });
    if (campaignLead) await advanceSequence(ctx, campaignLead.id, sentAt);
  }

  if (providerIsMock && getEnv().DEMO_MODE && getEnv().DEMO_SIMULATE_EVENTS) {
    const { scheduleSimulation } = await import("./simulator");
    await scheduleSimulation(ctx, message.id, channel);
  }
  return { status: "sent" };
}

/** User-initiated send (manual mode drafts, approved messages, replies). */
export async function queueSend(ctx: TenantContext, messageId: string) {
  await getQueue().enqueue("messages.send", { organizationId: ctx.organizationId, messageId }, { jobId: `send:${messageId}:${Date.now()}` });
}
