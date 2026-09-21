import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { upsertBusinessProfile } from "../../src/business/service";
import { addLeadsToCampaign } from "../../src/campaigns/audience";
import { estimateLaunch, launchCampaign, pauseCampaign } from "../../src/campaigns/lifecycle";
import { createCampaign } from "../../src/campaigns/service";
import { getCampaignStats } from "../../src/campaigns/stats";
import type { TenantContext } from "../../src/context";
import { encryptJson } from "../../src/crypto";
import { NotFoundError, PreconditionError, ValidationError } from "../../src/errors";
import { approveMessage, listApprovals } from "../../src/outreach/approvals";
import { getConversation, listConversations, sendDirectMessage } from "../../src/outreach/inbox";
import { analyzeInboundMessage, handleInboundMessage } from "../../src/outreach/inbound";
import { sendMessage } from "../../src/outreach/send";
import { prepareCampaignStep } from "../../src/outreach/sequence";
import { processUnsubscribe, unsubscribeToken } from "../../src/outreach/unsubscribe";
import { ingestEmailWebhook, processWebhookEvent } from "../../src/outreach/webhooks";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

const SEQUENCE = [
  { channel: "EMAIL" as const, delayDays: 0, condition: "ALWAYS" as const, name: "Opener", subject: "Hello {{business_name}}", body: "Hi {{first_name}}, {{personal_observation}} {{call_to_action}}", useAI: false },
  { channel: "EMAIL" as const, delayDays: 3, condition: "NO_REPLY" as const, name: "Follow-up", subject: "Re: Hello {{business_name}}", body: "Hi {{first_name}}, {{follow_up_hook}}", useAI: false },
];

async function setup() {
  const workspace = await createWorkspace("Outreach Co");
  await setPlan(workspace.organizationId, "pro");
  await upsertBusinessProfile(workspace.ctx, {
    name: "Outreach Co",
    industry: "Marketing agency",
    description: "Social media for cafés.",
    businessSize: "SMALL",
    valueProposition: "More customers from social media.",
  });
  return workspace;
}

async function leadWithEmail(ctx: TenantContext, name: string) {
  const lead = await createLead(ctx, { name, email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`, status: "QUALIFIED", score: 80 });
  await ctx.db.contact.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, name: "Priya Sethi", email: lead.email, isPrimary: true, source: "manual" } });
  return lead;
}

async function assistedCampaign(ctx: TenantContext, leadIds: string[]) {
  const campaign = await createCampaign(ctx, { name: "Cafés", automationMode: "ASSISTED", target: {}, channels: ["EMAIL"], steps: SEQUENCE });
  await addLeadsToCampaign(ctx, campaign.id, leadIds);
  return campaign;
}

/** Launch, then run the first step for every member (what the sequences tick does). */
async function launchAndPrepare(ctx: TenantContext, campaignId: string) {
  await launchCampaign(ctx, campaignId, { confirm: true });
  const members = await ctx.db.campaignLead.findMany({ where: { campaignId } });
  for (const member of members) await prepareCampaignStep(ctx, member.id);
  return members;
}

describe("outreach engine", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires explicit confirmation and reports an honest estimate before launch", async () => {
    const { ctx } = await setup();
    const reachable = await leadWithEmail(ctx, "Monsoon Cafe");
    const noEmail = await createLead(ctx, { name: "Phone Only Cafe", phone: "+919811111111", status: "QUALIFIED" });
    const campaign = await assistedCampaign(ctx, [reachable.id, noEmail.id]);

    const estimate = await estimateLaunch(ctx, campaign.id);
    expect(estimate.audience).toBe(2);
    expect(estimate.eligible.EMAIL).toBe(1);
    expect(estimate.blocked).toContainEqual({ reason: "No email address", count: 1 });
    expect(estimate.messages.EMAIL).toBe(2); // two steps × one reachable lead
    expect(estimate.providers.EMAIL).toMatchObject({ ok: true, simulated: true });

    await expect(launchCampaign(ctx, campaign.id, { confirm: false })).rejects.toBeInstanceOf(ValidationError);
    await launchCampaign(ctx, campaign.id, { confirm: true });
    expect((await ctx.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("ACTIVE");
  });

  it("assisted mode: drafts wait for approval, then send through the provider and advance the sequence", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Monsoon Cafe");
    const campaign = await assistedCampaign(ctx, [lead.id]);
    await launchAndPrepare(ctx, campaign.id);

    const { items } = await listApprovals(ctx, { campaignId: campaign.id });
    expect(items).toHaveLength(1);
    const draft = items[0];
    if (!draft) throw new Error("expected a draft");
    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(draft.subject).toBe("Hello Monsoon Cafe");
    expect(draft.body).toContain("Hi Priya");
    expect(await ctx.db.message.count({ where: { status: "SENT" } })).toBe(0);

    await approveMessage(ctx, draft.id, { body: `${draft.body}\n\nEdited by a human.` });
    const outcome = await sendMessage(ctx, draft.id);
    expect(outcome.status).toBe("sent");

    const sent = await ctx.db.message.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.provider).toBe("mock");
    expect(sent.body).toContain("Edited by a human.");
    expect(sent.metadata).toMatchObject({ simulated: true, editedByHuman: true });
    expect(await ctx.db.event.count({ where: { type: "email_sent", messageId: draft.id } })).toBe(1);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CONTACTED");
    const usage = await ctx.db.usageRecord.count({ where: { metric: "EMAIL_SENDS" } });
    expect(usage).toBe(1);

    const member = await ctx.db.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(member.status).toBe("IN_SEQUENCE");
    expect(member.nextStepOrder).toBe(1);
    expect(member.nextActionAt!.getTime() - Date.now()).toBeGreaterThan(2.9 * 86_400_000);

    // Sending again is a no-op (job retries can't double-send).
    expect((await sendMessage(ctx, draft.id)).status).toBe("skipped");
  });

  it("a reply stops the sequence, cancels queued follow-ups and is classified", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Monsoon Cafe");
    const campaign = await assistedCampaign(ctx, [lead.id]);
    await launchAndPrepare(ctx, campaign.id);
    const draft = (await listApprovals(ctx, { campaignId: campaign.id })).items[0]!;
    await approveMessage(ctx, draft.id);
    await sendMessage(ctx, draft.id);
    const sent = await ctx.db.message.findUniqueOrThrow({ where: { id: draft.id } });

    // A follow-up that was already queued must be cancelled by the reply.
    const followUpStep = await ctx.db.campaignStep.findFirstOrThrow({ where: { campaignId: campaign.id, order: 1 } });
    const queued = await ctx.db.message.create({
      data: { organizationId: ctx.organizationId, conversationId: sent.conversationId, leadId: lead.id, campaignId: campaign.id, campaignStepId: followUpStep.id, channel: "EMAIL", direction: "OUTBOUND", status: "APPROVED", body: "follow-up" },
    });

    const inbound = await handleInboundMessage(ctx, {
      channel: "EMAIL",
      from: `Priya <${lead.email}>`,
      subject: "Re: Hello Monsoon Cafe",
      body: "Sure, happy to talk. Would Thursday afternoon work?",
      provider: "mock",
      providerMessageId: `in_${randomUUID()}`,
      inReplyTo: sent.internetMessageId,
    });
    expect(inbound.messageId).toBeTruthy();
    expect((await ctx.db.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } })).status).toBe("REPLIED");
    expect((await ctx.db.message.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("CANCELED");

    const analysis = await analyzeInboundMessage(ctx, inbound.messageId!);
    expect(analysis?.intent).toBe("MEETING_REQUEST");
    const conversation = await getConversation(ctx, sent.conversationId);
    expect(conversation.status).toBe("NEEDS_RESPONSE");
    expect(conversation.aiIntent).toBe("MEETING_REQUEST");
    expect(conversation.suggestedReply).toBeTruthy();
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("INTERESTED");

    const stats = await getCampaignStats(ctx, campaign.id);
    expect(stats.leads).toMatchObject({ contacted: 1, replied: 1, positive: 1 });
    expect(stats.rates.reply).toBe(1);

    // Duplicate provider delivery of the same inbound message is ignored.
    const again = await handleInboundMessage(ctx, { channel: "EMAIL", from: lead.email!, body: "dup", provider: "mock", providerMessageId: (await ctx.db.message.findUniqueOrThrow({ where: { id: inbound.messageId! } })).providerMessageId! });
    expect(again.duplicate).toBe(true);
  });

  it("an opt-out reply suppresses the lead everywhere", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Quiet Cafe");
    const campaign = await assistedCampaign(ctx, [lead.id]);
    await launchAndPrepare(ctx, campaign.id);
    const draft = (await listApprovals(ctx, { campaignId: campaign.id })).items[0]!;
    await approveMessage(ctx, draft.id);
    await sendMessage(ctx, draft.id);

    const inbound = await handleInboundMessage(ctx, { channel: "EMAIL", from: lead.email!, body: "Please remove me from your list.", provider: "mock", providerMessageId: `in_${randomUUID()}` });
    const analysis = await analyzeInboundMessage(ctx, inbound.messageId!);
    expect(analysis?.optOut).toBe(true);

    // New messages are refused up front…
    await expect(sendDirectMessage(ctx, lead.id, { channel: "EMAIL", subject: "One more thing", body: "Hi again" })).rejects.toBeInstanceOf(PreconditionError);
    // …and anything approved before the opt-out is blocked at send time.
    const conversation = await ctx.db.conversation.findFirstOrThrow({ where: { leadId: lead.id } });
    const stale = await ctx.db.message.create({
      data: { organizationId: ctx.organizationId, conversationId: conversation.id, leadId: lead.id, channel: "EMAIL", direction: "OUTBOUND", status: "APPROVED", subject: "Earlier draft", body: "Hi", toAddress: lead.email },
    });
    expect((await sendMessage(ctx, stale.id)).status).toBe("blocked");
    expect((await ctx.db.message.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("SUPPRESSED");
  });

  it("one live sequence per lead: leads running elsewhere are skipped", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Busy Cafe");
    await assistedCampaign(ctx, [lead.id]);
    const second = await createCampaign(ctx, { name: "Second", automationMode: "ASSISTED", target: {}, channels: ["EMAIL"], steps: SEQUENCE });
    const result = await addLeadsToCampaign(ctx, second.id, [lead.id]);
    expect(result.added).toBe(0);
    expect(result.skipped).toContainEqual({ leadId: lead.id, reason: "active in another campaign" });
  });

  it("paused campaigns don't send", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Paused Cafe");
    const campaign = await assistedCampaign(ctx, [lead.id]);
    await launchAndPrepare(ctx, campaign.id);
    const draft = (await listApprovals(ctx, { campaignId: campaign.id })).items[0]!;
    await approveMessage(ctx, draft.id);
    await pauseCampaign(ctx, campaign.id);
    expect((await sendMessage(ctx, draft.id)).status).toBe("skipped");
    expect((await ctx.db.message.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("APPROVED");
  });

  it("WhatsApp steps without opt-in are skipped, not sent", async () => {
    const { ctx } = await setup();
    const lead = await createLead(ctx, { name: "No Optin Cafe", phone: "+919822222222", status: "QUALIFIED" });
    await ctx.db.contact.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, name: "Ravi", phone: lead.phone, whatsapp: lead.phone, isPrimary: true, source: "manual" } });
    const campaign = await createCampaign(ctx, {
      name: "WhatsApp",
      automationMode: "ASSISTED",
      target: {},
      channels: ["WHATSAPP"],
      steps: [{ channel: "WHATSAPP", delayDays: 0, condition: "ALWAYS", name: "Hello", subject: null, body: "Hi {{first_name}}", useAI: false }],
    });
    await addLeadsToCampaign(ctx, campaign.id, [lead.id]);
    await launchCampaign(ctx, campaign.id, { confirm: true });
    const member = await ctx.db.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
    const result = await prepareCampaignStep(ctx, member.id);
    expect(result.status).toBe("skipped");
    expect(await ctx.db.message.count()).toBe(0);
  });

  it("unsubscribe links are signed and idempotent", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Unsub Cafe");
    const token = unsubscribeToken({ organizationId: ctx.organizationId, leadId: lead.id, email: lead.email! });
    expect((await processUnsubscribe(`${token}x`)).ok).toBe(false);
    expect((await processUnsubscribe(token)).ok).toBe(true);
    expect((await processUnsubscribe(token)).ok).toBe(true);
    expect(await ctx.db.suppression.count({ where: { reason: "UNSUBSCRIBE" } })).toBeGreaterThan(0);
    expect(await ctx.db.event.count({ where: { type: "email_unsubscribed" } })).toBe(1);
  });

  it("signed provider webhooks are verified, stored once and applied", async () => {
    const { ctx } = await setup();
    const lead = await leadWithEmail(ctx, "Webhook Cafe");
    const direct = await sendDirectMessage(ctx, lead.id, { channel: "EMAIL", subject: "Hi", body: "Hello" });
    await sendMessage(ctx, direct.id);
    const message = await ctx.db.message.findUniqueOrThrow({ where: { id: direct.id } });
    // Pretend the message went out through Resend so the webhook can match it.
    await ctx.db.message.update({ where: { id: message.id }, data: { provider: "resend", providerMessageId: "re_123" } });

    const secret = `whsec_${Buffer.from("test-secret-key").toString("base64")}`;
    const integration = await prisma.integration.create({
      data: { organizationId: ctx.organizationId, category: "EMAIL", provider: "resend", status: "CONNECTED", encryptedCredentials: encryptJson({ apiKey: "re_test", webhookSecret: secret }) },
    });
    const body = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "re_123", to: [lead.email] } });
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from("test-secret-key")).update(`${id}.${timestamp}.${body}`).digest("base64");
    const request = (sig: string) => ({ headers: new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` }), rawBody: body, url: "http://localhost/api/webhooks/email/resend" });

    await expect(ingestEmailWebhook("resend", request("bad"), { integrationId: integration.id })).rejects.toMatchObject({ status: 401 });
    expect(await ingestEmailWebhook("resend", request(signature), { integrationId: integration.id })).toMatchObject({ accepted: 1 });
    expect(await ingestEmailWebhook("resend", request(signature), { integrationId: integration.id })).toMatchObject({ duplicates: 1 });

    const stored = await prisma.webhookEvent.findFirstOrThrow({ where: { provider: "resend" } });
    await processWebhookEvent(stored.id);
    expect((await ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe("DELIVERED");
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe("PROCESSED");
  });

  it("conversations are isolated between workspaces", async () => {
    const a = await setup();
    const b = await createWorkspace("Other Co");
    const lead = await leadWithEmail(a.ctx, "Private Cafe");
    const direct = await sendDirectMessage(a.ctx, lead.id, { channel: "EMAIL", subject: "Hi", body: "Hello" });
    await sendMessage(a.ctx, direct.id);
    expect((await listConversations(a.ctx)).items).toHaveLength(1);
    expect((await listConversations(b.ctx)).items).toHaveLength(0);
    await expect(getConversation(b.ctx, direct.conversationId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
