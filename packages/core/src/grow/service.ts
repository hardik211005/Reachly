import { randomBytes } from "node:crypto";
import { getEnv } from "@repo/config/env";
import { prisma, type Event } from "@repo/db";
import { z } from "zod";
import { audit } from "../audit";
import { assertCan, systemContext, type TenantContext } from "../context";
import { hashToken } from "../crypto";
import { NotFoundError, PreconditionError } from "../errors";
import { recordEvent } from "../events";
import { dedupeKeyFor, normalizeEmail, normalizePhone } from "../leads/normalize";
import { changeLeadStatus } from "../leads/service";
import { logger } from "../logger";
import { notify } from "../notifications";

/**
 * Grow: everything after "find and win" —
 *   • a public page per business (/b/<slug>) with services, prices, reviews and an enquiry form
 *     that lands in the CRM as an interested lead with an open deal;
 *   • reviews only from real customers, through a private invite link (/r/<token>), so the page
 *     can never show invented reviews;
 *   • after-win follow-ups: when a deal is won, a review request and a repeat-business check-in.
 */

const appUrl = () => getEnv().APP_URL.replace(/\/+$/, "");
export const publicPageUrl = (slug: string) => `${appUrl()}/b/${slug}`;
export const reviewUrl = (token: string) => `${appUrl()}/r/${token}`;

// ----------------------------------------------------------------------------- Settings

export const publicPageSettingsSchema = z.object({
  enabled: z.boolean(),
  headline: z.string().trim().max(120).nullish().transform((value) => value || null),
  about: z.string().trim().max(2000).nullish().transform((value) => value || null),
  showPrices: z.boolean(),
  acceptEnquiries: z.boolean(),
  afterWinFollowUps: z.boolean(),
});
export type PublicPageSettingsInput = z.input<typeof publicPageSettingsSchema>;

export async function getPublicPageSettings(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const [page, organization, since] = await Promise.all([
    ctx.db.publicPage.findFirst(),
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { slug: true } }),
    Promise.resolve(new Date(Date.now() - 30 * 86_400_000)),
  ]);
  const [enquiries, published, requested, average] = await Promise.all([
    ctx.db.lead.count({ where: { sourceType: "INBOUND", createdAt: { gte: since } } }),
    ctx.db.review.count({ where: { status: "PUBLISHED" } }),
    ctx.db.review.count({ where: { status: "REQUESTED" } }),
    ctx.db.review.aggregate({ where: { status: "PUBLISHED" }, _avg: { rating: true } }),
  ]);
  return {
    enabled: page?.enabled ?? false,
    headline: page?.headline ?? null,
    about: page?.about ?? null,
    showPrices: page?.showPrices ?? true,
    acceptEnquiries: page?.acceptEnquiries ?? true,
    afterWinFollowUps: page?.afterWinFollowUps ?? true,
    url: publicPageUrl(organization.slug),
    stats: { enquiries30d: enquiries, publishedReviews: published, pendingReviewRequests: requested, averageRating: average._avg.rating ? Math.round(average._avg.rating * 10) / 10 : null },
  };
}

export async function updatePublicPageSettings(ctx: TenantContext, input: PublicPageSettingsInput) {
  assertCan(ctx, "workspace:manage");
  const data = publicPageSettingsSchema.parse(input);
  const page = await ctx.db.publicPage.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, ...data }, update: data });
  await audit(ctx, { action: "public_page.updated", resourceType: "public_page", resourceId: page.id, metadata: { enabled: data.enabled, showPrices: data.showPrices, acceptEnquiries: data.acceptEnquiries, afterWinFollowUps: data.afterWinFollowUps } });
  return getPublicPageSettings(ctx);
}

// ----------------------------------------------------------------------------- Public page

/** What anyone can see at /b/<slug>. Null when the page is off or the workspace is gone. */
export async function getPublicPage(slug: string) {
  const organization = await prisma.organization.findFirst({
    where: { slug, deletedAt: null, onboardingCompleted: true, publicPage: { enabled: true } },
    select: {
      id: true, name: true, logoUrl: true, currency: true,
      publicPage: { select: { headline: true, about: true, showPrices: true, acceptEnquiries: true } },
      businessProfile: { select: { name: true, industry: true, description: true, website: true, city: true, region: true, valueProposition: true } },
    },
  });
  if (!organization?.publicPage) return null;
  const [offerings, reviews, stats] = await Promise.all([
    prisma.offering.findMany({ where: { organizationId: organization.id, deletedAt: null, isActive: true }, orderBy: { createdAt: "asc" }, take: 24, select: { id: true, type: true, name: true, description: true, unit: true, unitPrice: true, currency: true } }),
    prisma.review.findMany({ where: { organizationId: organization.id, status: "PUBLISHED" }, orderBy: { submittedAt: "desc" }, take: 20, select: { id: true, rating: true, comment: true, authorName: true, authorRole: true, submittedAt: true } }),
    prisma.review.aggregate({ where: { organizationId: organization.id, status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const page = organization.publicPage;
  return {
    name: organization.businessProfile?.name ?? organization.name,
    logoUrl: organization.logoUrl,
    headline: page.headline ?? organization.businessProfile?.valueProposition ?? null,
    about: page.about ?? organization.businessProfile?.description ?? null,
    industry: organization.businessProfile?.industry ?? null,
    city: [organization.businessProfile?.city, organization.businessProfile?.region].filter(Boolean).join(", ") || null,
    website: organization.businessProfile?.website ?? null,
    acceptEnquiries: page.acceptEnquiries,
    offerings: offerings.map((offering) => ({ ...offering, unitPrice: page.showPrices && offering.unitPrice !== null ? Number(offering.unitPrice) : null })),
    reviews,
    rating: { average: stats._avg.rating ? Math.round(stats._avg.rating * 10) / 10 : null, count: stats._count._all },
  };
}

export const enquirySchema = z
  .object({
    name: z.string().trim().min(2, "Tell them your name").max(120),
    company: z.string().trim().max(160).optional().transform((value) => value || undefined),
    email: z.string().trim().toLowerCase().max(200).optional().transform((value) => value || undefined).pipe(z.email("Enter a valid email address").optional()),
    phone: z.string().trim().max(30).optional().transform((value) => value || undefined),
    message: z.string().trim().min(10, "Add a little more detail (10+ characters)").max(3000),
    /** Honeypot: hidden from people, filled in by bots. */
    website: z.string().max(200).optional(),
  })
  .refine((value) => value.email || value.phone, { message: "Leave an email or a phone number so they can reply", path: ["email"] });
export type EnquiryInput = z.input<typeof enquirySchema>;

/**
 * An enquiry from the public page becomes an interested lead (with the message as a note), which
 * opens a deal in the CRM and fires workflows like any other lead. Inbound leads never use
 * lead credits.
 */
export async function submitEnquiry(slug: string, input: EnquiryInput | z.output<typeof enquirySchema>, meta: { ip?: string | null } = {}) {
  const data = enquirySchema.parse(input);
  const organization = await prisma.organization.findFirst({ where: { slug, deletedAt: null, publicPage: { enabled: true, acceptEnquiries: true } }, select: { id: true, name: true, memberships: { where: { role: "OWNER" }, take: 1, select: { userId: true } } } });
  if (!organization) throw new NotFoundError("Public page", slug);
  const ipHash = meta.ip ? hashToken(`enquiry:${meta.ip}`).slice(0, 32) : null;
  if (data.website) {
    logger.info({ ipHash, organizationId: organization.id }, "enquiry honeypot triggered");
    return { received: true };
  }

  const ctx = systemContext(organization.id);
  const email = normalizeEmail(data.email ?? null);
  const phone = normalizePhone(data.phone ?? null, "IN");
  const displayName = data.company ?? data.name;
  // The same person enquiring twice adds to their existing lead instead of duplicating it.
  const existing = await ctx.db.lead.findFirst({
    where: { deletedAt: null, OR: [...(email ? [{ email }, { contacts: { some: { email } } }] : []), ...(phone ? [{ phone }] : [])] },
    select: { id: true, status: true },
  });
  let leadId: string;
  if (existing) {
    leadId = existing.id;
  } else {
    const lead = await ctx.db.lead.create({
      data: {
        organizationId: organization.id,
        name: displayName,
        dedupeKey: `inbound:${dedupeKeyFor({ website: null, phone, name: displayName, city: null, country: null })}:${email ?? ""}`,
        email,
        phone,
        sourceType: "INBOUND",
        sourceProvider: "public_page",
        description: data.message.slice(0, 500),
        tags: ["enquiry"],
      },
    });
    leadId = lead.id;
    await ctx.db.contact.create({ data: { organizationId: organization.id, leadId, kind: "PERSON", name: data.name, email, phone, isPrimary: true, source: "public_page" } });
    await recordEvent(ctx, { type: "lead_created", leadId, properties: { source: "inbound", via: "public_page" }, idempotencyKey: `lead_created:${leadId}` });
  }
  await ctx.db.note.create({ data: { organizationId: organization.id, leadId, body: `Enquiry from your public page — ${data.name}${data.company ? ` (${data.company})` : ""}${email ? ` · ${email}` : ""}${phone ? ` · ${phone}` : ""}\n\n${data.message}` } });
  if (!existing || existing.status === "NEW" || existing.status === "QUALIFIED" || existing.status === "CONTACTED") {
    await changeLeadStatus(ctx, leadId, "INTERESTED", "Enquiry from the public page");
  }
  await notify(ctx, { type: "reply.positive", userId: organization.memberships[0]?.userId ?? null, title: `New enquiry from ${displayName}`, body: data.message.slice(0, 160), link: `/app/leads/${leadId}` });
  return { received: true };
}

// ----------------------------------------------------------------------------- Reviews

const newToken = () => randomBytes(18).toString("base64url");

/** Creates (or reuses) a private review link for a customer. Only real leads/deals can be reviewed. */
export async function requestReview(ctx: TenantContext, input: { leadId?: string | null; dealId?: string | null }) {
  assertCan(ctx, "crm:write");
  const deal = input.dealId ? await ctx.db.deal.findFirst({ where: { id: input.dealId, deletedAt: null }, select: { id: true, leadId: true } }) : null;
  const leadId = deal?.leadId ?? input.leadId ?? null;
  if (!leadId) throw new PreconditionError("Pick the customer to ask for a review");
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, name: true, phone: true, email: true } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  const open = await ctx.db.review.findFirst({ where: { leadId, status: "REQUESTED" }, orderBy: { requestedAt: "desc" } });
  const review = open ?? (await ctx.db.review.create({ data: { organizationId: ctx.organizationId, leadId, dealId: deal?.id ?? null, token: newToken() } }));
  if (!open) await audit(ctx, { action: "review.requested", resourceType: "review", resourceId: review.id, metadata: { leadId } });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  const url = reviewUrl(review.token);
  const message = `Hi! Thank you for choosing ${organization.name}. Would you take a minute to share your experience? ${url}`;
  const phone = lead.phone?.replace(/[^\d]/g, "");
  return { id: review.id, url, message, whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`, customer: lead.name };
}

export async function listReviews(ctx: TenantContext) {
  assertCan(ctx, "crm:read");
  const reviews = await ctx.db.review.findMany({ orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { requestedAt: "desc" }], take: 200, include: { lead: { select: { id: true, name: true } } } });
  return reviews.map((review) => ({ id: review.id, status: review.status, rating: review.rating, comment: review.comment, authorName: review.authorName, authorRole: review.authorRole, requestedAt: review.requestedAt, submittedAt: review.submittedAt, lead: review.lead, url: review.status === "REQUESTED" ? reviewUrl(review.token) : null }));
}

export async function setReviewVisibility(ctx: TenantContext, id: string, visible: boolean) {
  assertCan(ctx, "crm:write");
  const review = await ctx.db.review.findFirst({ where: { id } });
  if (!review) throw new NotFoundError("Review", id);
  if (review.status === "REQUESTED") throw new PreconditionError("This customer hasn't left their review yet");
  const updated = await ctx.db.review.update({ where: { id }, data: { status: visible ? "PUBLISHED" : "HIDDEN" } });
  await audit(ctx, { action: visible ? "review.published" : "review.hidden", resourceType: "review", resourceId: id });
  return updated;
}

/** What the customer sees on their private link. */
export async function getReviewInvite(token: string) {
  const review = await prisma.review.findUnique({ where: { token }, select: { status: true, rating: true, lead: { select: { name: true, contacts: { where: { isPrimary: true }, take: 1, select: { name: true } } } }, organization: { select: { name: true, logoUrl: true, deletedAt: true, businessProfile: { select: { name: true } } } } } });
  if (!review || review.organization.deletedAt) return null;
  return {
    business: review.organization.businessProfile?.name ?? review.organization.name,
    logoUrl: review.organization.logoUrl,
    done: review.status !== "REQUESTED",
    suggestedName: review.lead?.contacts[0]?.name ?? null,
    suggestedRole: review.lead?.name ?? null,
  };
}

export const reviewSubmissionSchema = z.object({
  rating: z.number().int().min(1, "Pick a rating").max(5),
  comment: z.string().trim().min(5, "Add a few words about your experience").max(2000),
  authorName: z.string().trim().min(2, "Add your name").max(80),
  authorRole: z.string().trim().max(120).optional().transform((value) => value || null),
});

export async function submitReview(token: string, input: z.input<typeof reviewSubmissionSchema> | z.output<typeof reviewSubmissionSchema>) {
  const data = reviewSubmissionSchema.parse(input);
  const review = await prisma.review.findUnique({ where: { token }, select: { id: true, status: true, organizationId: true, leadId: true } });
  if (!review) throw new NotFoundError("Review link", token);
  if (review.status !== "REQUESTED") throw new PreconditionError("This review has already been submitted — thank you!");
  await prisma.review.update({ where: { id: review.id }, data: { ...data, status: "PUBLISHED", submittedAt: new Date() } });
  const ctx = systemContext(review.organizationId);
  const owner = await prisma.membership.findFirst({ where: { organizationId: review.organizationId, role: "OWNER" }, select: { userId: true } });
  await notify(ctx, { type: "system", userId: owner?.userId ?? null, title: `${data.authorName} left a ${data.rating}★ review`, body: data.comment.slice(0, 160), link: "/app/grow" });
  return { submitted: true };
}

// ----------------------------------------------------------------------------- After a win

/**
 * When a deal is won (and the workspace keeps after-win follow-ups on): a private review link and
 * two follow-up tasks — ask for the review in 3 days, check back for repeat business in 30.
 */
export async function afterDealWon(ctx: TenantContext, event: Event) {
  if (event.type !== "deal_won" || !event.leadId) return;
  const page = await ctx.db.publicPage.findFirst({ select: { afterWinFollowUps: true } });
  if (page && !page.afterWinFollowUps) return;
  const lead = await ctx.db.lead.findFirst({ where: { id: event.leadId, deletedAt: null }, select: { id: true, name: true, ownerId: true } });
  if (!lead) return;
  // Once per deal, however many times the event is replayed.
  if (await ctx.db.task.findFirst({ where: { dealId: event.dealId ?? undefined, leadId: lead.id, title: { startsWith: "Ask " } }, select: { id: true } })) return;
  const invite = await requestReview(ctx, { leadId: lead.id, dealId: event.dealId });
  const now = Date.now();
  await ctx.db.task.createMany({
    data: [
      { organizationId: ctx.organizationId, leadId: lead.id, dealId: event.dealId, title: `Ask ${lead.name} for a review`, description: `Send them their private review link:\n${invite.url}`, type: "FOLLOW_UP", priority: "MEDIUM", dueAt: new Date(now + 3 * 86_400_000), assigneeId: lead.ownerId },
      { organizationId: ctx.organizationId, leadId: lead.id, dealId: event.dealId, title: `Check in with ${lead.name} for repeat business`, description: "A month after the win: see how it's going, offer a reorder or a referral discount.", type: "FOLLOW_UP", priority: "LOW", dueAt: new Date(now + 30 * 86_400_000), assigneeId: lead.ownerId },
    ],
  });
}
