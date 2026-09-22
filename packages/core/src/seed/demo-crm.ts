import { createHash } from "node:crypto";
import type { DealStage, LeadStatus } from "@repo/config";
import type { Lead } from "@repo/db";
import type { TenantContext } from "../context";
import { changeDealStage, createDeal, ensureDealAtStage } from "../crm/deals";
import { createMeeting } from "../crm/meetings";
import { createTask } from "../crm/tasks";
import { addNote } from "../leads/service";
import { loadCatalog } from "../quotes/catalog";
import { createQuote, expireQuotes, generateQuoteDraft, quotePublicToken, respondToQuote, sendQuote, viewPublicQuote } from "../quotes/service";
import { getQuoteSettings } from "../quotes/settings";

/**
 * Demo CRM: the deals the pipeline would have opened as leads warmed up, plus quotes in every
 * state, next steps, notes and meetings. Everything goes through the CRM and quote services
 * (so events, lead statuses and deal values stay consistent), then gets backdated.
 */

const DAY = 86_400_000;

function unit(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32LE(0) / 0xffffffff;
}

function daysAgo(days: number, hourUtc = 6): Date {
  const date = new Date(Date.now() - days * DAY);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

function daysAhead(days: number, hourUtc: number): Date {
  const date = new Date(Date.now() + days * DAY);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

const STAGE_FOR: Partial<Record<LeadStatus, DealStage>> = { INTERESTED: "INTERESTED", MEETING: "MEETING", QUOTE_SENT: "PROPOSAL" };

export async function seedDemoCrm(ctx: TenantContext, ownerId: string) {
  await getQuoteSettings(ctx);
  await ctx.db.quoteSettings.update({
    where: { organizationId: ctx.organizationId },
    data: {
      legalName: "Demo Growth Agency LLP",
      address: "4th Floor, Sector 29, Gurugram, Haryana 122001",
      taxId: "06AAKFD4321M1Z9",
      email: "hello@demogrowth.example",
      phone: "+91 98100 45210",
    },
  });

  const catalog = await loadCatalog(ctx);
  const offering = (name: string) => catalog.offerings.find((item) => item.name === name)!;
  const social = offering("Social media management");
  const website = offering("Website development");
  const seo = offering("Local SEO");
  const branding = offering("Branding");
  const ads = offering("Paid ads management");
  const bundle = offering("Growth starter bundle");

  /** What a realistic first proposal for this kind of business looks like. */
  function packageFor(lead: Lead) {
    const roll = unit(`package:${lead.name}`);
    const category = lead.category ?? "";
    if (/cafe|restaurant|bakery|cloud_kitchen/.test(category)) {
      return roll < 0.5 ? [{ offeringId: social.id, quantity: 6 }] : [{ offeringId: bundle.id, quantity: 3 }, { offeringId: branding.id, quantity: 1 }];
    }
    if (/d2c|brand|retail/.test(category)) return roll < 0.5 ? [{ offeringId: ads.id, quantity: 6 }] : [{ offeringId: ads.id, quantity: 3 }, { offeringId: branding.id, quantity: 1 }];
    return roll < 0.5 ? [{ offeringId: website.id, quantity: 1 }] : [{ offeringId: website.id, quantity: 1 }, { offeringId: seo.id, quantity: 3 }];
  }
  function estimate(lines: Array<{ offeringId: string; quantity: number }>) {
    return lines.reduce((sum, line) => {
      const item = catalog.offerings.find((entry) => entry.id === line.offeringId)!;
      return sum + (item.unitPrice ?? 0) * line.quantity + (item.setupFee ?? 0);
    }, 0);
  }

  const leads = await ctx.db.lead.findMany({ where: { deletedAt: null, doNotContact: false }, orderBy: { name: "asc" }, include: { contacts: { where: { deletedAt: null } } } });
  const used = new Set<string>();
  const take = (statuses: LeadStatus[], count: number) => {
    const picked = leads.filter((lead) => statuses.includes(lead.status as LeadStatus) && !used.has(lead.id)).slice(0, count);
    for (const lead of picked) used.add(lead.id);
    return picked;
  };

  // 1. Warm leads get the deal the pipeline opens automatically (Interested / Meeting / Quote sent).
  const warm = leads.filter((lead) => STAGE_FOR[lead.status as LeadStatus]);
  const deals: Array<{ lead: (typeof leads)[number]; dealId: string; stage: DealStage }> = [];
  for (const lead of warm) {
    used.add(lead.id);
    const changed = await ctx.db.event.findFirst({ where: { leadId: lead.id, type: "lead_status_changed" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
    const source = await ctx.db.event.findFirst({ where: { leadId: lead.id, channel: { not: null }, type: { in: ["reply_classified", "call_completed", "meeting_created"] } }, orderBy: { occurredAt: "desc" }, select: { channel: true } });
    const stage = STAGE_FOR[lead.status as LeadStatus]!;
    const deal = await ensureDealAtStage(ctx, lead.id, stage, { fromLead: true, source: "lead_status", sourceChannel: source?.channel ?? null });
    if (!deal) continue;
    const at = changed?.occurredAt ?? daysAgo(5);
    await ctx.db.deal.update({ where: { id: deal.id }, data: { value: estimate(packageFor(lead)), createdAt: at, stageChangedAt: at, ownerId } });
    deals.push({ lead, dealId: deal.id, stage });
  }

  // 2. Earlier-stage deals the team added by hand.
  const early = take(["REPLIED", "CONTACTED", "QUALIFIED"], 4);
  for (const [index, lead] of early.entries()) {
    const stage: DealStage = index < 2 ? "QUALIFIED" : "CONTACTED";
    const deal = await createDeal(ctx, { leadId: lead.id, stage, value: estimate(packageFor(lead)), ownerId, expectedCloseDate: daysAhead(30 + index * 7, 6) }, { source: "manual" });
    await ctx.db.deal.update({ where: { id: deal.id }, data: { createdAt: daysAgo(9 + index * 3), stageChangedAt: daysAgo(4 + index) } });
    deals.push({ lead, dealId: deal.id, stage });
  }

  const contactName = (lead: (typeof leads)[number]) => lead.contacts.find((contact) => contact.kind === "PERSON" && contact.name)?.name ?? "The owner";
  const backdateQuote = async (quoteId: string, createdAt: Date, sentAt: Date | null) => {
    await ctx.db.quote.update({ where: { id: quoteId }, data: { createdAt, ...(sentAt ? { sentAt, validUntil: new Date(sentAt.getTime() + 15 * DAY) } : {}) } });
    if (sentAt) await ctx.db.quote.updateMany({ where: { id: quoteId, viewedAt: { not: null } }, data: { viewedAt: new Date(sentAt.getTime() + 5 * 3_600_000) } });
    await ctx.db.event.updateMany({ where: { type: { in: ["quote_created"] }, properties: { path: ["quoteId"], equals: quoteId } }, data: { occurredAt: createdAt } });
    if (sentAt) await ctx.db.event.updateMany({ where: { type: { in: ["quote_sent", "quote_viewed"] }, properties: { path: ["quoteId"], equals: quoteId } }, data: { occurredAt: sentAt } });
  };

  // 3. Quotes out for meeting-stage deals (sending moves them to Proposal); one has been opened.
  const meetingDeals = deals.filter((deal) => deal.stage === "MEETING");
  let quotes = 0;
  for (const [index, deal] of meetingDeals.slice(0, 2).entries()) {
    const quote = await createQuote(ctx, { leadId: deal.lead.id, dealId: deal.dealId, title: `Growth plan for ${deal.lead.name}`, notes: `Hi ${contactName(deal.lead).split(" ")[0]}, thanks for the call. Here's the plan we discussed — happy to adjust the scope.`, lines: packageFor(deal.lead) });
    await sendQuote(ctx, quote.id, { channel: "LINK" });
    if (index === 0) await viewPublicQuote(quotePublicToken(ctx.organizationId, quote.id), { recordView: true });
    await backdateQuote(quote.id, daysAgo(3 + index * 2), daysAgo(2 + index * 2, 9));
    deal.stage = "PROPOSAL";
    quotes += 1;
  }

  // 4. An AI draft waiting for review on the next meeting-stage deal.
  const nextMeeting = meetingDeals[2];
  if (nextMeeting) {
    await generateQuoteDraft(ctx, { leadId: nextMeeting.lead.id, dealId: nextMeeting.dealId });
    quotes += 1;
  }

  // 5. Closed deals: won (one through an accepted quote) and lost, with reasons.
  const closing = take(["REPLIED", "CONTACTED", "QUALIFIED"], 5);
  const wonDaysAgo = [2, 13, 41];
  for (const [index, lead] of closing.slice(0, 3).entries()) {
    const lines = packageFor(lead);
    const deal = await createDeal(ctx, { leadId: lead.id, stage: "NEGOTIATION", value: estimate(lines), ownerId }, { source: "manual" });
    const closedAt = daysAgo(wonDaysAgo[index]!, 8);
    if (index === 0) {
      const quote = await createQuote(ctx, { leadId: lead.id, dealId: deal.id, title: `Launch package for ${lead.name}`, lines });
      await sendQuote(ctx, quote.id, { channel: "LINK" });
      await respondToQuote(quotePublicToken(ctx.organizationId, quote.id), { decision: "accept", name: contactName(lead), note: "Looks good — let's start on the 1st." });
      await backdateQuote(quote.id, daysAgo(wonDaysAgo[index]! + 5), daysAgo(wonDaysAgo[index]! + 4, 9));
      await ctx.db.quote.update({ where: { id: quote.id }, data: { acceptedAt: closedAt } });
      await ctx.db.event.updateMany({ where: { type: "quote_accepted", properties: { path: ["quoteId"], equals: quote.id } }, data: { occurredAt: closedAt } });
      quotes += 1;
    } else {
      const fresh = await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } });
      await changeDealStage(ctx, fresh, { stage: "WON", value: Math.round(estimate(lines) * (index === 1 ? 0.9 : 1)), reason: "Signed" });
    }
    await ctx.db.deal.update({ where: { id: deal.id }, data: { createdAt: new Date(closedAt.getTime() - 24 * DAY), wonAt: closedAt, stageChangedAt: closedAt } });
    await ctx.db.event.updateMany({ where: { dealId: deal.id, type: { in: ["deal_won", "deal_stage_changed"] } }, data: { occurredAt: closedAt } });
  }
  const lostReasons = ["Price", "Chose a competitor"];
  for (const [index, lead] of closing.slice(3).entries()) {
    const deal = await createDeal(ctx, { leadId: lead.id, stage: "PROPOSAL", value: estimate(packageFor(lead)), ownerId }, { source: "manual" });
    const lostAt = daysAgo(index === 0 ? 8 : 25, 10);
    if (index === 0) {
      // Declined online: the quote and its follow-up task are real.
      const quote = await createQuote(ctx, { leadId: lead.id, dealId: deal.id, lines: packageFor(lead) });
      await sendQuote(ctx, quote.id, { channel: "LINK" });
      await respondToQuote(quotePublicToken(ctx.organizationId, quote.id), { decision: "decline", name: contactName(lead), note: "Over our budget for this quarter." });
      await backdateQuote(quote.id, daysAgo(12), daysAgo(11, 9));
      await ctx.db.quote.update({ where: { id: quote.id }, data: { rejectedAt: lostAt } });
      quotes += 1;
    }
    const fresh = await ctx.db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    await changeDealStage(ctx, fresh, { stage: "LOST", lostReason: lostReasons[index] });
    await ctx.db.deal.update({ where: { id: deal.id }, data: { createdAt: new Date(lostAt.getTime() - 18 * DAY), lostAt, stageChangedAt: lostAt } });
    await ctx.db.event.updateMany({ where: { dealId: deal.id, type: { in: ["deal_lost", "deal_stage_changed"] } }, data: { occurredAt: lostAt } });
  }

  // 6. A quote that went unanswered and expired.
  const stale = deals.find((deal) => deal.stage === "INTERESTED");
  if (stale) {
    const quote = await createQuote(ctx, { leadId: stale.lead.id, dealId: stale.dealId, validUntil: new Date(Date.now() + DAY), lines: packageFor(stale.lead) });
    await sendQuote(ctx, quote.id, { channel: "LINK" });
    await backdateQuote(quote.id, daysAgo(19), daysAgo(18, 9));
    await ctx.db.quote.update({ where: { id: quote.id }, data: { validUntil: daysAgo(3) } });
    await expireQuotes();
    stale.stage = "PROPOSAL";
    quotes += 1;
  }

  // 7. Next steps, notes and meetings on the open deals.
  const open = deals.filter((deal) => !["WON", "LOST"].includes(deal.stage));
  const steps = [
    { title: "Send the revised scope", type: "EMAIL" as const, due: -1, priority: "HIGH" as const },
    { title: "Call to confirm budget and start date", type: "CALL" as const, due: 0, priority: "HIGH" as const },
    { title: "Share two case studies", type: "EMAIL" as const, due: 1, priority: "MEDIUM" as const },
    { title: "Follow up on the proposal", type: "FOLLOW_UP" as const, due: 3, priority: "MEDIUM" as const },
    { title: "Prepare mock-ups for the pitch", type: "TODO" as const, due: 5, priority: "LOW" as const },
  ];
  let tasks = 0;
  for (const [index, deal] of open.entries()) {
    const hasTask = await ctx.db.task.findFirst({ where: { status: "OPEN", OR: [{ dealId: deal.dealId }, { leadId: deal.lead.id }] }, select: { id: true } });
    if (hasTask) continue;
    const step = steps[index % steps.length]!;
    await createTask(ctx, { title: step.title, type: step.type, priority: step.priority, dueAt: daysAhead(step.due, 12), leadId: deal.lead.id, dealId: deal.dealId, assigneeId: ownerId });
    tasks += 1;
  }
  const notes = [
    "Owner handles marketing personally; decision in two weeks. Budget around ₹40k a month.",
    "Asked for examples from other cafés in South Delhi. Wants Instagram first, website later.",
    "Currently working with a freelancer — unhappy with reporting. Good opening for us.",
  ];
  for (const [index, deal] of open.slice(0, notes.length).entries()) {
    await addNote(ctx, { leadId: deal.lead.id, dealId: deal.dealId, body: notes[index]! });
  }
  let meetings = 0;
  for (const [index, deal] of open.filter((item) => item.stage === "MEETING" || item.stage === "PROPOSAL").slice(0, 2).entries()) {
    await createMeeting(ctx, { leadId: deal.lead.id, dealId: deal.dealId, title: index === 0 ? `Proposal walkthrough — ${deal.lead.name}` : `Discovery call — ${deal.lead.name}`, scheduledAt: daysAhead(index === 0 ? 1 : 3, index === 0 ? 5 : 10), durationMinutes: index === 0 ? 45 : 30, location: "Google Meet" });
    meetings += 1;
  }

  const [dealCount, won] = await Promise.all([ctx.db.deal.count({ where: { deletedAt: null } }), ctx.db.deal.count({ where: { stage: "WON" } })]);
  return { deals: dealCount, won, quotes, tasks, meetings };
}
