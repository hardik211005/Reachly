import { beforeEach, describe, expect, it } from "vitest";
import { createOffering, upsertBusinessProfile } from "../../src/business/service";
import type { TenantContext } from "../../src/context";
import { createDeal, getDeal, listPipeline, moveDeal, syncDealFromLeadEvent } from "../../src/crm/deals";
import { createMeeting, meetingIcs } from "../../src/crm/meetings";
import { FeatureNotInPlanError, PreconditionError, ValidationError } from "../../src/errors";
import { changeLeadStatus } from "../../src/leads/service";
import { createPricingRule } from "../../src/quotes/catalog";
import { renderQuotePdf } from "../../src/quotes/pdf";
import { createQuote, expireQuotes, generateQuoteDraft, getQuote, quotePublicToken, respondToQuote, sendQuote, updateQuote, viewPublicQuote } from "../../src/quotes/service";
import { createLead, createWorkspace, resetDatabase, setPlan } from "./helpers";

async function setup(plan = "pro") {
  const workspace = await createWorkspace("Pipeline Co");
  await setPlan(workspace.organizationId, plan);
  await upsertBusinessProfile(workspace.ctx, { name: "Pipeline Co", industry: "Agency", description: "Growth agency for cafés and restaurants.", businessSize: "SMALL" });
  return workspace;
}

async function catalog(ctx: TenantContext) {
  const social = await createOffering(ctx, { type: "SERVICE", name: "Social media management", unit: "month", unitPrice: 35_000, taxRatePercent: 18 });
  const website = await createOffering(ctx, { type: "SERVICE", name: "Website development", unit: "project", unitPrice: 85_000, setupFee: 10_000, taxRatePercent: 18 });
  const custom = await createOffering(ctx, { type: "PRODUCT", name: "Custom packaging", unit: "project", unitPrice: null, taxRatePercent: 18 });
  await createPricingRule(ctx, { name: "6+ months", type: "VOLUME_DISCOUNT_PERCENT", offeringId: social.id, minQuantity: 6, value: 10 });
  return { social, website, custom };
}

async function latestEvent(ctx: TenantContext, type: string) {
  return ctx.db.event.findFirst({ where: { type: type as never }, orderBy: { occurredAt: "desc" } });
}

describe("deals and pipeline", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("moves deals through the pipeline and keeps the lead in step, forward only", async () => {
    const { ctx } = await setup();
    const lead = await createLead(ctx, { name: "Monsoon Cafe", status: "CONTACTED" });
    const deal = await createDeal(ctx, { leadId: lead.id, value: 120_000, stage: "INTERESTED" });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("INTERESTED");
    expect(await latestEvent(ctx, "deal_created")).toMatchObject({ dealId: deal.id });

    await moveDeal(ctx, deal.id, { stage: "MEETING" });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("MEETING");
    expect((await latestEvent(ctx, "deal_stage_changed"))?.properties).toMatchObject({ from: "INTERESTED", to: "MEETING" });

    await expect(moveDeal(ctx, deal.id, { stage: "LOST" })).rejects.toBeInstanceOf(ValidationError);
    await moveDeal(ctx, deal.id, { stage: "LOST", lostReason: "Price" });
    expect(await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ stage: "LOST", lostReason: "Price" });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("LOST");

    // Reopening a lost deal reopens the lead.
    await moveDeal(ctx, deal.id, { stage: "NEGOTIATION" });
    expect(await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ stage: "NEGOTIATION", lostReason: null, lostAt: null });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("QUOTE_SENT");
  });

  it("orders cards within a column from drag-and-drop neighbours", async () => {
    const { ctx } = await setup();
    const make = async (name: string) => createDeal(ctx, { leadId: (await createLead(ctx, { name })).id, stage: "QUALIFIED" });
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    // New deals go to the top: C, B, A.
    let column = (await listPipeline(ctx)).deals.filter((deal) => deal.stage === "QUALIFIED").map((deal) => deal.title);
    expect(column).toEqual(["C", "B", "A"]);
    await moveDeal(ctx, c.id, { stage: "QUALIFIED", prevId: b.id, nextId: a.id });
    column = (await listPipeline(ctx)).deals.filter((deal) => deal.stage === "QUALIFIED").map((deal) => deal.title);
    expect(column).toEqual(["B", "C", "A"]);
    const pipeline = await listPipeline(ctx);
    expect(pipeline.stages.find((stage) => stage.stage === "QUALIFIED")).toMatchObject({ count: 3 });
  });

  it("opens and advances a deal when the lead becomes interested, never backwards", async () => {
    const { ctx } = await setup();
    const lead = await createLead(ctx, { name: "Chai Point", status: "REPLIED" });
    const sync = async () => syncDealFromLeadEvent(ctx, (await latestEvent(ctx, "lead_status_changed"))!);

    await changeLeadStatus(ctx, lead.id, "INTERESTED");
    await sync();
    const deal = await ctx.db.deal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(deal.stage).toBe("INTERESTED");

    await changeLeadStatus(ctx, lead.id, "QUOTE_SENT");
    await sync();
    expect((await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe("PROPOSAL");

    await changeLeadStatus(ctx, lead.id, "INTERESTED");
    await sync();
    expect((await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe("PROPOSAL");
    expect(await ctx.db.deal.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("books meetings that move the lead forward and export to calendars", async () => {
    const { ctx } = await setup();
    const lead = await createLead(ctx, { name: "Bean There", status: "INTERESTED" });
    const meeting = await createMeeting(ctx, { leadId: lead.id, title: "Intro call", scheduledAt: new Date("2026-10-01T09:30:00Z"), durationMinutes: 45, location: "Google Meet" });
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("MEETING");
    const ics = await meetingIcs(ctx, meeting.id);
    expect(ics.body).toContain("DTSTART:20261001T093000Z");
    expect(ics.body).toContain("DTEND:20261001T101500Z");
    expect(ics.body).toContain("LOCATION:Google Meet");
  });
});

describe("quotes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prices from the catalog and numbers quotes uniquely, even in parallel", async () => {
    const { ctx } = await setup();
    const { social, website } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Monsoon Cafe" });
    const quote = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: social.id, quantity: 6 }, { offeringId: website.id, quantity: 1 }] });
    expect(quote.number).toBe(`Q-${new Date().getFullYear()}-0001`);
    expect(quote).toMatchObject({ status: "DRAFT", subtotal: 305_000, discountTotal: 21_000, taxTotal: 51_120, total: 335_120, taxableTotal: 284_000, issues: [] });
    expect(quote.lines[0]?.appliedRules[0]).toMatchObject({ name: "6+ months", amount: 21_000 });

    const numbers = await Promise.all(Array.from({ length: 5 }, () => createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: website.id, quantity: 1 }] }).then((item) => item.number)));
    expect(new Set(numbers).size).toBe(5);
  });

  it("won't send a quote until every price is known, then moves the deal to Proposal", async () => {
    const { ctx } = await setup();
    const { social, custom } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Tea Trails", status: "MEETING" });
    const draft = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: social.id, quantity: 3 }, { offeringId: custom.id, quantity: 1 }] });
    expect(draft.issues[0]).toMatch(/no list price/);
    await expect(sendQuote(ctx, draft.id, { channel: "LINK" })).rejects.toBeInstanceOf(ValidationError);

    // The user enters the agreed price — that's the only other source of prices.
    const priced = await updateQuote(ctx, draft.id, { lines: [{ offeringId: social.id, quantity: 3 }, { offeringId: custom.id, quantity: 1, unitPrice: 40_000 }] });
    expect(priced.issues).toEqual([]);
    expect(priced.lines[1]).toMatchObject({ priceSource: "manual", unitPrice: 40_000 });

    const sent = await sendQuote(ctx, draft.id, { channel: "LINK" });
    expect(sent.status).toBe("SENT");
    const deal = await ctx.db.deal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(deal).toMatchObject({ stage: "PROPOSAL" });
    expect(Number(deal.value)).toBe(145_000);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("QUOTE_SENT");
    await expect(updateQuote(ctx, draft.id, { title: "Changed" })).rejects.toBeInstanceOf(PreconditionError);
  });

  it("emails the quote with a link to view and accept it", async () => {
    const { ctx } = await setup();
    const { website } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Brew Lab", email: "owner@brewlab.test" });
    const quote = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: website.id, quantity: 1 }] });
    await sendQuote(ctx, quote.id, { channel: "EMAIL" });
    const message = await ctx.db.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(message).toMatchObject({ channel: "EMAIL", toAddress: "owner@brewlab.test", status: "APPROVED" });
    expect(message.subject).toContain(quote.number);
    expect(message.body).toContain(quote.publicUrl);
    expect(message.metadata).toMatchObject({ quoteId: quote.id });
  });

  it("the prospect views and accepts online: deal won, lead won, team notified", async () => {
    const { ctx, organizationId } = await setup();
    const { social } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Spice Route", status: "INTERESTED" });
    const quote = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: social.id, quantity: 6 }] });
    const token = quotePublicToken(organizationId, quote.id);

    // Drafts aren't visible publicly.
    await expect(viewPublicQuote(token)).rejects.toMatchObject({ status: 404 });
    await sendQuote(ctx, quote.id, { channel: "LINK" });

    await viewPublicQuote(token, { recordView: true });
    await viewPublicQuote(token, { recordView: true });
    expect(await ctx.db.event.count({ where: { type: "quote_viewed" } })).toBe(1);
    expect(await ctx.db.notification.findFirst({ where: { type: "quote.viewed" } })).toBeTruthy();

    const result = await respondToQuote(token, { decision: "accept", name: "Priya Sharma", note: "Let's start in October" });
    expect(result).toMatchObject({ status: "ACCEPTED", respondedByName: "Priya Sharma" });
    const deal = await ctx.db.deal.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(deal.stage).toBe("WON");
    expect(Number(deal.value)).toBe(189_000);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("WON");
    expect(await ctx.db.event.count({ where: { type: { in: ["quote_accepted", "deal_won"] } } })).toBe(2);
    expect(await ctx.db.notification.findFirst({ where: { type: "quote.accepted" } })).toMatchObject({ title: expect.stringContaining("accepted quote") });

    // A second answer doesn't change anything.
    expect(await respondToQuote(token, { decision: "decline", name: "Someone Else" })).toMatchObject({ status: "ACCEPTED" });
    await expect(respondToQuote(`${token}x`, { decision: "accept", name: "Mallory" })).rejects.toMatchObject({ status: 404 });
  });

  it("a declined quote creates a follow-up task; stale quotes expire", async () => {
    const { ctx, organizationId } = await setup();
    const { website } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Curry Co" });
    const declined = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: website.id, quantity: 1 }] });
    await sendQuote(ctx, declined.id, { channel: "LINK" });
    await respondToQuote(quotePublicToken(organizationId, declined.id), { decision: "decline", name: "Ravi", note: "Over budget this quarter" });
    expect(await ctx.db.task.findFirst({ where: { leadId: lead.id } })).toMatchObject({ title: `Follow up on declined quote ${declined.number}`, priority: "HIGH", description: "Over budget this quarter" });

    const stale = await createQuote(ctx, { leadId: lead.id, validUntil: new Date(Date.now() + 86_400_000), lines: [{ offeringId: website.id, quantity: 1 }] });
    await sendQuote(ctx, stale.id, { channel: "LINK" });
    await expireQuotes(new Date(Date.now() + 2 * 86_400_000));
    expect((await getQuote(ctx, stale.id)).status).toBe("EXPIRED");
    await expect(respondToQuote(quotePublicToken(organizationId, stale.id), { decision: "accept", name: "Ravi" })).rejects.toBeInstanceOf(PreconditionError);
  });

  it("AI drafts use catalog items and catalog prices only", async () => {
    const { ctx } = await setup();
    const { social, website } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Daily Grind", status: "INTERESTED" });
    const conversation = await ctx.db.conversation.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, channel: "EMAIL" } });
    await ctx.db.message.create({
      data: { organizationId: ctx.organizationId, conversationId: conversation.id, leadId: lead.id, channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", body: "We'd love help with social media for 6 months. What would that cost?" },
    });
    const { quote, reasons } = await generateQuoteDraft(ctx, { leadId: lead.id });
    expect(quote.generatedByAI).toBe(true);
    expect(quote.lines.map((line) => line.offeringId)).toEqual([social.id]);
    expect(quote.lines[0]).toMatchObject({ quantity: 6, unitPrice: 35_000, priceSource: "catalog" });
    expect(quote.lines.map((line) => line.offeringId)).not.toContain(website.id);
    expect(reasons[0]?.reason).toMatch(/came up in the conversation/);
    expect(quote.notes).not.toMatch(/₹|\d{4,}/);
  });

  it("renders a PDF and a deal view with its quotes", async () => {
    const { ctx } = await setup();
    const { social } = await catalog(ctx);
    const lead = await createLead(ctx, { name: "Pixel Bakes" });
    const deal = await createDeal(ctx, { leadId: lead.id, stage: "MEETING" });
    const quote = await createQuote(ctx, { leadId: lead.id, lines: [{ offeringId: social.id, quantity: 2 }] });
    expect(quote.deal?.id).toBe(deal.id);
    const pdf = await renderQuotePdf(quote);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    const view = await getDeal(ctx, deal.id);
    expect(view.quotes.map((item) => item.number)).toEqual([quote.number]);
  });

  it("quotes need the plan feature", async () => {
    const { ctx } = await setup("free");
    const lead = await createLead(ctx);
    await expect(createQuote(ctx, { leadId: lead.id, lines: [] })).rejects.toBeInstanceOf(FeatureNotInPlanError);
  });
});
