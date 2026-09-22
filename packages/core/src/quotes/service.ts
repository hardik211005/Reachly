import { getEnv } from "@repo/config/env";
import { prisma, type Prisma, type Quote, type QuoteLineItem } from "@repo/db";
import { z } from "zod";
import { runAgent } from "../ai/service";
import { draftQuoteDeterministically, quoteDraftAgent, type QuoteDraft, type QuoteDraftInput } from "../ai/agents/quote";
import { audit } from "../audit";
import { assertFeature } from "../billing/plans";
import { assertCan, systemContext, type TenantContext } from "../context";
import { changeDealStage, ensureDealAtStage, openDealForLead } from "../crm/deals";
import { createTask } from "../crm/tasks";
import { signToken, verifyToken, type SignedTokenPayload } from "../crypto";
import { AppError, NotFoundError, PreconditionError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { notify } from "../notifications";
import { primaryContact } from "../outreach/context";
import { sendDirectMessage } from "../outreach/inbox";
import { firstName } from "../shared/text";
import { loadCatalog } from "./catalog";
import { formatMoney, priceQuote, type AppliedRule, type LineInput, type PricedLine } from "./pricing";
import { getQuoteSettings, nextQuoteNumber } from "./settings";

// ----------------------------------------------------------------------------- Schemas

export const quoteLineSchema = z
  .object({
    offeringId: z.uuid().nullable().optional(),
    description: z.string().trim().max(200).nullable().optional(),
    details: z.string().trim().max(500).nullable().optional(),
    quantity: z.number().int().min(1).max(10_000_000),
    unit: z.string().trim().max(40).nullable().optional(),
    unitPrice: z.number().nonnegative().max(10_000_000_000).nullable().optional(),
    setupFee: z.number().nonnegative().max(10_000_000_000).nullable().optional(),
    discount: z.number().nonnegative().max(10_000_000_000).nullable().optional(),
    taxRatePercent: z.number().min(0).max(100).nullable().optional(),
  })
  .refine((line) => Boolean(line.offeringId) || Boolean(line.description), { message: "Custom lines need a description", path: ["description"] });

export const quoteInputSchema = z.object({
  leadId: z.uuid(),
  dealId: z.uuid().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  lines: z.array(quoteLineSchema).max(50).default([]),
});
export type QuoteInput = z.input<typeof quoteInputSchema>;

export const quoteUpdateSchema = quoteInputSchema.omit({ leadId: true }).partial();

export const quoteListSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
  leadId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const sendQuoteSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP", "LINK"]),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000).optional(),
});

export const quoteResponseSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  name: z.string().trim().min(2).max(120),
  note: z.string().trim().max(1000).optional(),
});

// ----------------------------------------------------------------------------- View

type FullQuote = Quote & {
  lineItems: QuoteLineItem[];
  lead: { id: string; name: string; city: string | null; address: string | null; email: string | null; phone: string | null };
  contact: { id: string; name: string | null; email: string | null; phone: string | null; title: string | null } | null;
  deal: { id: string; title: string; stage: string } | null;
};

const quoteInclude = {
  lineItems: { orderBy: { position: "asc" } },
  lead: { select: { id: true, name: true, city: true, address: true, email: true, phone: true } },
  contact: { select: { id: true, name: true, email: true, phone: true, title: true } },
  deal: { select: { id: true, title: true, stage: true } },
} satisfies Prisma.QuoteInclude;

interface QuoteToken extends SignedTokenPayload {
  o: string;
  q: string;
}

export function quotePublicToken(organizationId: string, quoteId: string): string {
  return signToken({ p: "quote", o: organizationId, q: quoteId });
}

export function quotePublicUrl(organizationId: string, quoteId: string): string {
  return `${getEnv().APP_URL}/q/${quotePublicToken(organizationId, quoteId)}`;
}

function manualDiscount(rules: AppliedRule[]): number | null {
  const manual = rules.filter((rule) => rule.type === "MANUAL_DISCOUNT").reduce((sum, rule) => sum + rule.amount, 0);
  return manual > 0 ? manual : null;
}

/** The editable input a stored line came from (catalog prices re-resolve; typed values stick). */
export function lineInputFromItem(item: QuoteLineItem): LineInput {
  const rules = (item.appliedRules ?? []) as unknown as AppliedRule[];
  return {
    offeringId: item.offeringId,
    description: item.description,
    details: item.details,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.priceSource === "manual" ? Number(item.unitPrice) : null,
    setupFee: item.offeringId ? null : Number(item.setupFee) || null,
    discount: manualDiscount(rules),
    taxRatePercent: Number(item.taxRatePercent),
  };
}

function lineView(item: QuoteLineItem) {
  const subtotal = Number(item.unitPrice) * item.quantity + Number(item.setupFee);
  const lineTotal = Number(item.lineTotal);
  return {
    id: item.id,
    offeringId: item.offeringId,
    description: item.description,
    details: item.details,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.priceSource === "missing" ? null : Number(item.unitPrice),
    setupFee: Number(item.setupFee),
    discount: Number(item.discount),
    taxRatePercent: Number(item.taxRatePercent),
    subtotal: Math.round(subtotal * 100) / 100,
    lineTotal,
    tax: Math.round(lineTotal * Number(item.taxRatePercent)) / 100,
    priceSource: item.priceSource as PricedLine["priceSource"],
    appliedRules: (item.appliedRules ?? []) as unknown as AppliedRule[],
    input: lineInputFromItem(item),
  };
}
export type QuoteLineView = ReturnType<typeof lineView>;

async function sellerDetails(ctx: TenantContext) {
  const [settings, org, profile] = await Promise.all([
    getQuoteSettings(ctx),
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true, logoUrl: true, currency: true } }),
    ctx.db.businessProfile.findFirst({ select: { name: true, website: true } }),
  ]);
  return {
    name: profile?.name ?? org.name,
    legalName: settings.legalName,
    address: settings.address,
    taxId: settings.taxId,
    email: settings.email,
    phone: settings.phone,
    website: profile?.website ?? null,
    footer: settings.footer,
    logoUrl: org.logoUrl,
  };
}

async function toView(ctx: TenantContext, quote: FullQuote) {
  const seller = await sellerDetails(ctx);
  const lines = quote.lineItems.map(lineView);
  let issues: string[] = [];
  if (quote.status === "DRAFT") {
    // Drafts are re-checked against today's catalog (removed items, missing prices, minimums).
    const catalog = await loadCatalog(ctx);
    issues = priceQuote(lines.map((line) => line.input), catalog, { currency: quote.currency }).issues;
    if (!lines.length) issues.push("Add at least one item");
  }
  const taxRates = [...new Set(lines.filter((line) => line.tax > 0).map((line) => line.taxRatePercent))];
  const taxLabel = quote.currency === "INR" ? "GST" : "Tax";
  const token = quotePublicToken(ctx.organizationId, quote.id);
  const expired = quote.status === "EXPIRED" || (quote.status === "SENT" && quote.validUntil !== null && quote.validUntil < new Date());
  return {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    status: quote.status,
    expired,
    currency: quote.currency,
    subtotal: Number(quote.subtotal),
    discountTotal: Number(quote.discountTotal),
    taxTotal: Number(quote.taxTotal),
    total: Number(quote.total),
    taxableTotal: Math.round((Number(quote.subtotal) - Number(quote.discountTotal)) * 100) / 100,
    taxLabel: taxRates.length === 1 ? `${taxLabel} ${taxRates[0]}%` : taxLabel,
    validUntil: quote.validUntil,
    notes: quote.notes,
    terms: quote.terms,
    generatedByAI: quote.generatedByAI,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    viewedAt: quote.viewedAt,
    acceptedAt: quote.acceptedAt,
    rejectedAt: quote.rejectedAt,
    respondedByName: quote.respondedByName,
    responseNote: quote.responseNote,
    lead: quote.lead,
    contact: quote.contact,
    deal: quote.deal,
    seller,
    lines,
    issues,
    publicUrl: `${getEnv().APP_URL}/q/${token}`,
    publicPdfUrl: `${getEnv().APP_URL}/api/public/quotes/${token}/pdf`,
  };
}
export type QuoteView = Awaited<ReturnType<typeof toView>>;

async function loadQuote(ctx: TenantContext, id: string): Promise<FullQuote> {
  const quote = await ctx.db.quote.findFirst({ where: { id, deletedAt: null }, include: quoteInclude });
  if (!quote) throw new NotFoundError("Quote", id);
  return quote as FullQuote;
}

export async function getQuote(ctx: TenantContext, id: string): Promise<QuoteView> {
  assertCan(ctx, "crm:read");
  return toView(ctx, await loadQuote(ctx, id));
}

// ----------------------------------------------------------------------------- Messages

function dateText(date: Date | null | undefined): string {
  return date ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date) : "";
}

/** WhatsApp-ready summary (WhatsApp renders *bold*). */
export function quoteWhatsAppText(view: QuoteView): string {
  const first = firstName(view.contact?.name);
  const money = (amount: number) => formatMoney(amount, view.currency);
  const lines = view.lines.map((line) => `• ${line.description} — ${line.quantity} ${line.unit}${line.quantity === 1 || line.unit.endsWith("s") ? "" : "s"}: ${line.unitPrice === null ? "price to confirm" : money(line.lineTotal)}`);
  return [
    `Hi${first ? ` ${first}` : ""}, here's our quote ${view.number} for ${view.lead.name}:`,
    "",
    ...lines,
    ...(view.discountTotal > 0 ? [`Discount: −${money(view.discountTotal)}`] : []),
    ...(view.taxTotal > 0 ? [`${view.taxLabel}: ${money(view.taxTotal)}`] : []),
    `*Total: ${money(view.total)}*`,
    "",
    `${view.validUntil ? `Valid until ${dateText(view.validUntil)}. ` : ""}View, download or accept it here: ${view.publicUrl}`,
  ].join("\n");
}

export function quoteEmail(view: QuoteView, senderName: string | null): { subject: string; body: string } {
  const first = firstName(view.contact?.name);
  const money = (amount: number) => formatMoney(amount, view.currency);
  return {
    subject: `Quote ${view.number}${view.title ? ` — ${view.title}` : ""} from ${view.seller.name}`,
    body: [
      `Hi ${first ?? "there"},`,
      "",
      view.notes?.trim() || "Thanks for your time. As promised, here is our quote.",
      "",
      `Quote ${view.number}${view.title ? ` — ${view.title}` : ""}`,
      `Total: ${money(view.total)}${view.taxTotal > 0 ? ` (incl. ${view.taxLabel})` : ""}`,
      ...(view.validUntil ? [`Valid until: ${dateText(view.validUntil)}`] : []),
      "",
      `View, download the PDF or accept it online: ${view.publicUrl}`,
      "",
      "Happy to answer any questions.",
      "",
      senderName ?? view.seller.name,
      view.seller.name,
    ].join("\n"),
  };
}

/** Ready-to-send texts and recipients, so the send dialog shows exactly what goes out. */
export async function quoteMessages(ctx: TenantContext, id: string) {
  assertCan(ctx, "crm:read");
  const view = await getQuote(ctx, id);
  const lead = await ctx.db.lead.findFirst({ where: { id: view.lead.id }, include: { contacts: { where: { deletedAt: null } } } });
  const emailContact = lead ? primaryContact(lead.contacts, "EMAIL") : null;
  const whatsappContact = lead ? primaryContact(lead.contacts, "WHATSAPP") : null;
  const sender = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : null;
  return {
    email: { to: emailContact?.email ?? lead?.email ?? null, ...quoteEmail(view, sender?.name ?? null) },
    whatsapp: { to: whatsappContact?.whatsapp ?? whatsappContact?.phone ?? lead?.phone ?? null, text: quoteWhatsAppText(view) },
    link: view.publicUrl,
  };
}

// ----------------------------------------------------------------------------- Mutations

async function resolveLinks(ctx: TenantContext, data: { leadId: string; dealId?: string | null; contactId?: string | null }) {
  const lead = await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", data.leadId);
  let dealId: string | null = null;
  if (data.dealId) {
    const deal = await ctx.db.deal.findFirst({ where: { id: data.dealId, leadId: lead.id, deletedAt: null }, select: { id: true } });
    if (!deal) throw new ValidationError("Deal must belong to this lead");
    dealId = deal.id;
  } else if (data.dealId === undefined) {
    dealId = (await openDealForLead(ctx, lead.id))?.id ?? null;
  }
  let contactId: string | null = null;
  if (data.contactId) {
    if (!lead.contacts.some((contact) => contact.id === data.contactId)) throw new ValidationError("Contact must belong to this lead");
    contactId = data.contactId;
  } else if (data.contactId === undefined) {
    contactId = primaryContact(lead.contacts, "EMAIL")?.id ?? null;
  }
  return { lead, dealId, contactId };
}

function lineRows(priced: PricedLine[]) {
  return priced.map((line, index) => ({
    offeringId: line.offeringId,
    description: line.description,
    details: line.details,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice ?? 0,
    setupFee: line.setupFee,
    discount: line.discount,
    taxRatePercent: line.taxRatePercent,
    lineTotal: line.lineTotal,
    appliedRules: line.appliedRules as unknown as Prisma.InputJsonValue,
    priceSource: line.priceSource,
    position: index,
  }));
}

export async function createQuote(ctx: TenantContext, input: QuoteInput, options: { generatedByAI?: boolean } = {}): Promise<QuoteView> {
  assertCan(ctx, "quotes:write");
  await assertFeature(ctx, "quotes");
  const data = quoteInputSchema.parse(input);
  const { lead, dealId, contactId } = await resolveLinks(ctx, data);
  const [settings, catalog, org] = await Promise.all([getQuoteSettings(ctx), loadCatalog(ctx), prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true } })]);
  const priced = priceQuote(data.lines, catalog, { currency: org.currency });

  let quote: Quote | null = null;
  for (let attempt = 0; attempt < 3 && !quote; attempt += 1) {
    try {
      quote = await ctx.db.quote.create({
        data: {
          organizationId: ctx.organizationId,
          leadId: lead.id,
          dealId,
          contactId,
          number: await nextQuoteNumber(ctx),
          title: data.title ?? null,
          currency: org.currency,
          subtotal: priced.totals.subtotal,
          discountTotal: priced.totals.discountTotal,
          taxTotal: priced.totals.taxTotal,
          total: priced.totals.total,
          validUntil: data.validUntil ?? new Date(Date.now() + settings.validityDays * 86_400_000),
          notes: data.notes ?? null,
          terms: data.terms ?? settings.terms,
          generatedByAI: options.generatedByAI ?? false,
          createdById: ctx.userId,
          lineItems: { create: lineRows(priced.lines) },
        },
      });
    } catch (error) {
      // A hand-edited prefix/counter can collide with an existing number; take the next one.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  if (!quote) throw new PreconditionError("Couldn't allocate a quote number — check the numbering in quote settings");
  await recordEvent(ctx, { type: "quote_created", leadId: lead.id, dealId, properties: { quoteId: quote.id, number: quote.number, total: Number(quote.total), generatedByAI: quote.generatedByAI } });
  return getQuote(ctx, quote.id);
}

export async function updateQuote(ctx: TenantContext, id: string, input: z.input<typeof quoteUpdateSchema>): Promise<QuoteView> {
  assertCan(ctx, "quotes:write");
  const data = quoteUpdateSchema.parse(input);
  const quote = await loadQuote(ctx, id);
  if (quote.status !== "DRAFT") throw new PreconditionError("Sent quotes can't be edited — duplicate it to make a revision");
  const links = data.dealId !== undefined || data.contactId !== undefined ? await resolveLinks(ctx, { leadId: quote.leadId, dealId: data.dealId, contactId: data.contactId }) : null;
  let totals: { subtotal: number; discountTotal: number; taxTotal: number; total: number } | null = null;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  if (data.lines) {
    const catalog = await loadCatalog(ctx);
    const priced = priceQuote(data.lines, catalog, { currency: quote.currency });
    totals = priced.totals;
    writes.push(ctx.db.quoteLineItem.deleteMany({ where: { quoteId: id } }));
    writes.push(ctx.db.quoteLineItem.createMany({ data: lineRows(priced.lines).map((row) => ({ ...row, quoteId: id })) }));
  }
  writes.push(
    ctx.db.quote.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.validUntil !== undefined ? { validUntil: data.validUntil } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.terms !== undefined ? { terms: data.terms } : {}),
        ...(links && data.dealId !== undefined ? { dealId: links.dealId } : {}),
        ...(links && data.contactId !== undefined ? { contactId: links.contactId } : {}),
        ...(totals ?? {}),
      },
    }),
  );
  await ctx.db.$transaction(writes);
  return getQuote(ctx, id);
}

export async function duplicateQuote(ctx: TenantContext, id: string): Promise<QuoteView> {
  const quote = await loadQuote(ctx, id);
  return createQuote(ctx, {
    leadId: quote.leadId,
    dealId: quote.dealId,
    contactId: quote.contactId,
    title: quote.title,
    notes: quote.notes,
    terms: quote.terms,
    lines: quote.lineItems.map(lineInputFromItem),
  });
}

export async function deleteQuote(ctx: TenantContext, id: string) {
  assertCan(ctx, "quotes:write");
  const quote = await loadQuote(ctx, id);
  if (quote.status !== "DRAFT") throw new PreconditionError("Only drafts can be deleted; sent quotes are kept for your records");
  await ctx.db.quote.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "quote.deleted", resourceType: "quote", resourceId: id, metadata: { number: quote.number } });
}

export async function listQuotes(ctx: TenantContext, input: z.input<typeof quoteListSchema> = {}) {
  assertCan(ctx, "crm:read");
  const query = quoteListSchema.parse(input);
  const quotes = await ctx.db.quote.findMany({
    where: { deletedAt: null, lead: { deletedAt: null }, ...(query.status ? { status: query.status } : {}), ...(query.leadId ? { leadId: query.leadId } : {}), ...(query.dealId ? { dealId: query.dealId } : {}) },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: { lead: { select: { id: true, name: true } }, _count: { select: { lineItems: true } } },
  });
  const counts = await ctx.db.quote.groupBy({ by: ["status"], where: { deletedAt: null, lead: { deletedAt: null } }, _count: true, _sum: { total: true } });
  return {
    quotes: quotes.map((quote) => ({ ...quote, subtotal: Number(quote.subtotal), discountTotal: Number(quote.discountTotal), taxTotal: Number(quote.taxTotal), total: Number(quote.total) })),
    counts: Object.fromEntries(counts.map((row) => [row.status, { count: row._count, total: Number(row._sum.total ?? 0) }])),
  };
}

// ----------------------------------------------------------------------------- AI draft

/**
 * Drafts a quote from the conversation: the agent picks catalog items and quantities, the
 * pricing engine prices them. The draft is never sent automatically.
 */
export async function generateQuoteDraft(ctx: TenantContext, input: { leadId: string; dealId?: string | null }) {
  assertCan(ctx, "quotes:write");
  await assertFeature(ctx, "quotes");
  const lead = await ctx.db.lead.findFirst({ where: { id: input.leadId, deletedAt: null }, include: { contacts: { where: { deletedAt: null } } } });
  if (!lead) throw new NotFoundError("Lead", input.leadId);
  const catalog = await loadCatalog(ctx);
  const offerings = catalog.offerings.filter((offering) => offering.isActive);
  if (!offerings.length) throw new PreconditionError("Add your products or services to the catalog first — quotes only use catalog prices");

  const [messages, calls, notes, deal, profile] = await Promise.all([
    ctx.db.message.findMany({ where: { leadId: lead.id, status: { notIn: ["DRAFT", "CANCELED", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 12, select: { direction: true, channel: true, body: true, createdAt: true } }),
    ctx.db.call.findMany({ where: { leadId: lead.id, summary: { not: null } }, orderBy: { createdAt: "desc" }, take: 3, select: { summary: true, metadata: true, createdAt: true } }),
    ctx.db.note.findMany({ where: { leadId: lead.id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { body: true, createdAt: true } }),
    input.dealId ? ctx.db.deal.findFirst({ where: { id: input.dealId, leadId: lead.id, deletedAt: null } }) : openDealForLead(ctx, lead.id),
    ctx.db.businessProfile.findFirst({ select: { name: true } }),
  ]);
  const conversation = [
    ...messages.map((message) => ({ at: message.createdAt, source: message.channel.toLowerCase(), direction: message.direction as "INBOUND" | "OUTBOUND", text: message.body.slice(0, 600) })),
    ...calls.map((call) => ({ at: call.createdAt, source: "call", direction: "INBOUND" as const, text: [call.summary, ...(((call.metadata as { analysis?: { keyPoints?: string[] } } | null)?.analysis?.keyPoints) ?? [])].filter(Boolean).join(" ").slice(0, 600) })),
    ...notes.map((note) => ({ at: note.createdAt, source: "note", direction: "NOTE" as const, text: note.body.slice(0, 600) })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ at: _at, ...entry }) => entry);

  const contact = primaryContact(lead.contacts, "EMAIL");
  const agentInput: QuoteDraftInput = {
    seller: { name: profile?.name ?? "the seller" },
    lead: { name: lead.name, category: lead.category, city: lead.city, contactName: contact?.name ?? null },
    offerings: offerings.map((offering) => ({ id: offering.id, name: offering.name, description: offering.description, unit: offering.unit, minOrderQuantity: offering.minOrderQuantity })),
    conversation,
    dealTitle: deal?.title ?? null,
  };
  let draft: QuoteDraft;
  try {
    draft = (await runAgent(ctx, quoteDraftAgent, agentInput, { leadId: lead.id })).output;
  } catch (error) {
    logger.warn({ err: error, leadId: lead.id }, "quote draft agent failed; using the grounded template");
    draft = draftQuoteDeterministically(agentInput);
  }

  // Keep only real catalog items; quantities respect minimum orders. Prices come from the engine.
  const byId = new Map(offerings.map((offering) => [offering.id, offering]));
  const seen = new Set<string>();
  const questions = [...draft.questions];
  const reasons: Array<{ offeringId: string; reason: string }> = [];
  const lines: LineInput[] = [];
  for (const item of draft.items) {
    const offering = byId.get(item.offeringId);
    if (!offering || seen.has(offering.id)) continue;
    seen.add(offering.id);
    let quantity = Math.min(Math.max(1, Math.round(item.quantity)), 10_000_000);
    if (offering.minOrderQuantity && quantity < offering.minOrderQuantity) {
      questions.push(`${offering.name} has a minimum order of ${offering.minOrderQuantity} ${offering.unit}s — raised from ${quantity}.`);
      quantity = offering.minOrderQuantity;
    }
    lines.push({ offeringId: offering.id, quantity });
    reasons.push({ offeringId: offering.id, reason: item.reason });
  }
  if (!lines.length) {
    const fallback = draftQuoteDeterministically(agentInput);
    for (const item of fallback.items) {
      lines.push({ offeringId: item.offeringId, quantity: item.quantity });
      reasons.push({ offeringId: item.offeringId, reason: item.reason });
    }
  }
  const quote = await createQuote(ctx, { leadId: lead.id, dealId: deal?.id ?? null, title: draft.title.slice(0, 200), notes: draft.introduction.slice(0, 4000), lines }, { generatedByAI: true });
  return { quote, questions: [...new Set(questions)].slice(0, 6), reasons };
}

// ----------------------------------------------------------------------------- Send & respond

export async function sendQuote(ctx: TenantContext, id: string, input: z.input<typeof sendQuoteSchema>): Promise<QuoteView> {
  assertCan(ctx, "quotes:write");
  const data = sendQuoteSchema.parse(input);
  const quote = await loadQuote(ctx, id);
  if (!["DRAFT", "SENT"].includes(quote.status)) throw new PreconditionError(`This quote is ${quote.status.toLowerCase()} — duplicate it to send a new version`);
  const view = await toView(ctx, quote);
  if (view.issues.length) throw new ValidationError(view.issues[0] ?? "Fix the quote first", { issues: view.issues });
  if (quote.validUntil && quote.validUntil < new Date()) throw new PreconditionError("The validity date has passed — set a new one before sending");

  if (data.channel !== "LINK") {
    const sender = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : null;
    const email = quoteEmail(view, sender?.name ?? null);
    const body = data.message ?? (data.channel === "EMAIL" ? email.body : quoteWhatsAppText(view));
    await sendDirectMessage(ctx, quote.leadId, { channel: data.channel, subject: data.channel === "EMAIL" ? (data.subject ?? email.subject) : undefined, body, sendNow: true }, { metadata: { quoteId: quote.id } });
  }

  const now = new Date();
  await ctx.db.quote.update({ where: { id }, data: { status: "SENT", sentAt: quote.sentAt ?? now } });
  await recordEvent(ctx, { type: "quote_sent", leadId: quote.leadId, dealId: quote.dealId, channel: data.channel === "LINK" ? null : data.channel, value: view.taxableTotal, properties: { quoteId: id, number: quote.number, total: view.total, channel: data.channel } });
  // The pipeline follows: the deal moves to Proposal and takes the quote's value (before tax).
  const deal = await ensureDealAtStage(ctx, quote.leadId, "PROPOSAL", { value: view.taxableTotal, reason: `Quote ${quote.number} sent`, source: "quote" });
  if (deal && !quote.dealId) await ctx.db.quote.update({ where: { id }, data: { dealId: deal.id } });
  return getQuote(ctx, id);
}

async function applyResponse(ctx: TenantContext, quote: FullQuote, decision: "accept" | "decline", by: { name: string | null; note?: string; viaPage: boolean }) {
  const now = new Date();
  const accepted = decision === "accept";
  await ctx.db.quote.update({
    where: { id: quote.id },
    data: accepted
      ? { status: "ACCEPTED", acceptedAt: now, respondedByName: by.name, responseNote: by.note ?? null }
      : { status: "REJECTED", rejectedAt: now, respondedByName: by.name, responseNote: by.note ?? null },
  });
  const total = Number(quote.total);
  const taxable = Math.round((Number(quote.subtotal) - Number(quote.discountTotal)) * 100) / 100;
  await recordEvent(ctx, { type: accepted ? "quote_accepted" : "quote_rejected", leadId: quote.leadId, dealId: quote.dealId, properties: { quoteId: quote.id, number: quote.number, total, by: by.name, note: by.note ?? null, viaPage: by.viaPage } });
  const money = formatMoney(total, quote.currency, { decimals: false });
  if (by.viaPage) {
    await notify(ctx, {
      type: accepted ? "quote.accepted" : "quote.declined",
      title: accepted ? `${quote.lead.name} accepted quote ${quote.number} (${money})` : `${quote.lead.name} declined quote ${quote.number}`,
      body: [by.name ? `By ${by.name}` : null, by.note].filter(Boolean).join(" — ") || undefined,
      link: `/app/crm/quotes/${quote.id}`,
    });
  }
  if (accepted) {
    const deal = quote.dealId ? await ctx.db.deal.findFirst({ where: { id: quote.dealId, deletedAt: null } }) : await openDealForLead(ctx, quote.leadId);
    if (deal) await changeDealStage(ctx, deal, { stage: "WON", value: taxable, reason: `Quote ${quote.number} accepted` });
    else await ensureDealAtStage(ctx, quote.leadId, "WON", { value: taxable, reason: `Quote ${quote.number} accepted`, source: "quote" });
  } else {
    const lead = await ctx.db.lead.findFirst({ where: { id: quote.leadId }, select: { ownerId: true } });
    await createTask(ctx, { title: `Follow up on declined quote ${quote.number}`, description: by.note ?? null, type: "FOLLOW_UP", priority: "HIGH", dueAt: new Date(now.getTime() + 86_400_000), leadId: quote.leadId, dealId: quote.dealId, assigneeId: lead?.ownerId ?? null });
  }
}

/** A team member records the prospect's answer (e.g. accepted on a call). */
export async function markQuote(ctx: TenantContext, id: string, input: { decision: "accept" | "decline"; note?: string }) {
  assertCan(ctx, "quotes:write");
  const quote = await loadQuote(ctx, id);
  if (quote.status !== "SENT" && quote.status !== "EXPIRED") throw new PreconditionError("Only sent quotes can be marked accepted or declined");
  await applyResponse(ctx, quote, input.decision, { name: null, note: input.note, viaPage: false });
  return getQuote(ctx, id);
}

function readQuoteToken(token: string) {
  const payload = verifyToken<QuoteToken>(token, "quote");
  if (!payload) throw new AppError("NOT_FOUND", "This quote link isn't valid", 404);
  return payload;
}

/** The quote as the prospect sees it. The first open records a view and tells the team. */
export async function viewPublicQuote(token: string, options: { recordView?: boolean } = {}) {
  const payload = readQuoteToken(token);
  const ctx = systemContext(payload.o, { type: "SYSTEM", id: "quote-page" });
  const quote = await ctx.db.quote.findFirst({ where: { id: payload.q, deletedAt: null }, include: quoteInclude });
  if (!quote || quote.status === "DRAFT") throw new AppError("NOT_FOUND", "This quote isn't available", 404);
  if (options.recordView && quote.status === "SENT" && !quote.viewedAt) {
    const { count } = await ctx.db.quote.updateMany({ where: { id: quote.id, viewedAt: null }, data: { viewedAt: new Date() } });
    if (count) {
      await recordEvent(ctx, { type: "quote_viewed", leadId: quote.leadId, dealId: quote.dealId, properties: { quoteId: quote.id, number: quote.number } });
      await notify(ctx, { type: "quote.viewed", title: `${quote.lead.name} opened quote ${quote.number}`, link: `/app/crm/quotes/${quote.id}` });
    }
  }
  return { ctx, view: await toView(ctx, quote as FullQuote) };
}

export async function respondToQuote(token: string, input: z.input<typeof quoteResponseSchema>) {
  const data = quoteResponseSchema.parse(input);
  const payload = readQuoteToken(token);
  const ctx = systemContext(payload.o, { type: "SYSTEM", id: "quote-page" });
  const quote = await ctx.db.quote.findFirst({ where: { id: payload.q, deletedAt: null }, include: quoteInclude });
  if (!quote || quote.status === "DRAFT") throw new AppError("NOT_FOUND", "This quote isn't available", 404);
  if (quote.status === "ACCEPTED" || quote.status === "REJECTED") return toView(ctx, quote as FullQuote);
  if (quote.status === "EXPIRED" || (quote.validUntil && quote.validUntil < new Date())) throw new PreconditionError("This quote has expired — ask for an updated one");
  await applyResponse(ctx, quote as FullQuote, data.decision, { name: data.name, note: data.note, viaPage: true });
  return toView(ctx, await loadQuote(ctx, quote.id));
}

/** Job: sent quotes past their validity date become expired. */
export async function expireQuotes(now = new Date()) {
  const due = await prisma.quote.findMany({ where: { status: "SENT", deletedAt: null, validUntil: { lt: now } }, select: { id: true, organizationId: true, leadId: true, dealId: true, number: true }, take: 500 });
  for (const quote of due) {
    const ctx = systemContext(quote.organizationId);
    const { count } = await ctx.db.quote.updateMany({ where: { id: quote.id, status: "SENT" }, data: { status: "EXPIRED" } });
    if (count) await recordEvent(ctx, { type: "quote_expired", leadId: quote.leadId, dealId: quote.dealId, properties: { quoteId: quote.id, number: quote.number } });
  }
  return { expired: due.length };
}
