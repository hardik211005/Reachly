import { LEAD_STATUS_LABELS, type LeadStatus } from "@repo/config";
import { type Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { audit } from "../audit";
import { consumeUsage } from "../billing/usage";
import { addSuppression } from "../compliance/suppression";
import { assertCan, type TenantContext } from "../context";
import { ConflictError, NotFoundError, PreconditionError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { toCsv } from "../shared/csv";
import { dedupeKeyFor, normalizeDomain, normalizeEmail, normalizePhone, normalizeWebsite } from "./normalize";
import {
  bulkLeadActionSchema,
  contactInputSchema,
  importRequestSchema,
  leadCreateSchema,
  leadListQuerySchema,
  leadUpdateSchema,
  type BulkLeadAction,
  type ContactInput,
  type ImportRequest,
  type LeadCreateInput,
  type LeadListQueryInput,
  type LeadUpdateInput,
} from "./schemas";

// ----------------------------------------------------------------------------- List

export function whereFromQuery(query: ReturnType<typeof leadListQuerySchema.parse>): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [{ deletedAt: null }];
  if (!query.includeDnc && !query.status?.includes("DO_NOT_CONTACT")) and.push({ doNotContact: false });
  if (query.q) {
    const contains = { contains: query.q, mode: "insensitive" as const };
    and.push({ OR: [{ name: contains }, { domain: contains }, { city: contains }, { locality: contains }, { email: contains }, { phone: contains }, { category: contains }] });
  }
  if (query.status?.length) and.push({ status: { in: query.status } });
  if (query.fitTier?.length) and.push({ fitTier: { in: query.fitTier } });
  if (query.qualification?.length) and.push({ qualification: { in: query.qualification } });
  if (query.city?.length) and.push({ OR: query.city.map((city) => ({ city: { equals: city, mode: "insensitive" as const } })) });
  if (query.category?.length) and.push({ category: { in: query.category } });
  if (query.source?.length) and.push({ sourceProvider: { in: query.source } });
  if (query.campaignId) and.push({ campaignLeads: { some: { campaignId: query.campaignId } } });
  if (query.ownerId) and.push({ ownerId: query.ownerId });
  if (query.minScore !== undefined) and.push({ score: { gte: query.minScore } });
  if (query.maxScore !== undefined) and.push({ score: { lte: query.maxScore } });
  if (query.hasEmail) and.push({ OR: [{ email: { not: null } }, { contacts: { some: { email: { not: null }, deletedAt: null } } }] });
  if (query.hasPhone) and.push({ phone: { not: null } });
  if (query.discoveryRunId) and.push({ discoveryLinks: { some: { runId: query.discoveryRunId } } });
  if (query.ids?.length) and.push({ id: { in: query.ids } });
  return { AND: and };
}

function orderFromQuery(query: ReturnType<typeof leadListQuerySchema.parse>): Prisma.LeadOrderByWithRelationInput[] {
  const direction = query.order;
  switch (query.sort) {
    case "score":
      return [{ score: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
    case "lastActivityAt":
      return [{ lastActivityAt: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
    case "city":
      return [{ city: { sort: direction, nulls: "last" } }, { name: "asc" }];
    default:
      return [{ [query.sort]: direction }];
  }
}

export async function listLeads(ctx: TenantContext, input: LeadListQueryInput) {
  assertCan(ctx, "leads:read");
  const query = leadListQuerySchema.parse(input);
  const where = whereFromQuery(query);
  const [rows, total, statusCounts] = await Promise.all([
    ctx.db.lead.findMany({
      where,
      orderBy: orderFromQuery(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, name: true, category: true, industry: true, city: true, locality: true, website: true, domain: true,
        email: true, phone: true, score: true, fitTier: true, qualification: true, status: true, sourceType: true,
        sourceProvider: true, lastActivityAt: true, nextAction: true, nextActionAt: true, doNotContact: true,
        enrichmentStatus: true, createdAt: true, tags: true, reviewCount: true, rating: true,
        primaryCampaign: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        contacts: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          take: 1,
          select: { id: true, name: true, title: true, email: true, phone: true },
        },
      },
    }),
    ctx.db.lead.count({ where }),
    ctx.db.lead.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
  ]);
  return {
    items: rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    facets: { status: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) as Partial<Record<LeadStatus, number>> },
  };
}

/** Distinct values for filter menus. */
export async function leadFilterOptions(ctx: TenantContext) {
  assertCan(ctx, "leads:read");
  const [cities, categories, sources, campaigns] = await Promise.all([
    ctx.db.lead.groupBy({ by: ["city"], where: { deletedAt: null, city: { not: null } }, _count: { _all: true }, orderBy: { _count: { city: "desc" } }, take: 30 }),
    ctx.db.lead.groupBy({ by: ["category"], where: { deletedAt: null, category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: "desc" } }, take: 30 }),
    ctx.db.lead.groupBy({ by: ["sourceProvider"], where: { deletedAt: null }, _count: { _all: true } }),
    ctx.db.campaign.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    cities: cities.map((row) => ({ value: row.city as string, count: row._count._all })),
    categories: categories.map((row) => ({ value: row.category as string, count: row._count._all })),
    sources: sources.map((row) => ({ value: row.sourceProvider, count: row._count._all })),
    campaigns,
  };
}

// ----------------------------------------------------------------------------- Detail

export async function getLead(ctx: TenantContext, id: string) {
  assertCan(ctx, "leads:read");
  const lead = await ctx.db.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      primaryCampaign: { select: { id: true, name: true } },
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      sources: { orderBy: { fetchedAt: "desc" } },
      scores: { orderBy: { createdAt: "desc" }, take: 5 },
      campaignLeads: { include: { campaign: { select: { id: true, name: true, status: true, channels: true } } }, orderBy: { addedAt: "desc" } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: 20, include: { assignee: { select: { id: true, name: true } } } },
      deals: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) throw new NotFoundError("Lead", id);
  return lead;
}

export async function getLeadTimeline(ctx: TenantContext, leadId: string, options: { cursor?: string; limit?: number } = {}) {
  assertCan(ctx, "leads:read");
  const limit = Math.min(options.limit ?? 50, 200);
  const cursorEvent = options.cursor ? await ctx.db.event.findFirst({ where: { id: options.cursor, leadId }, select: { occurredAt: true } }) : null;
  const [events, notes] = await Promise.all([
    ctx.db.event.findMany({
      where: { leadId, ...(cursorEvent ? { occurredAt: { lt: cursorEvent.occurredAt } } : {}), type: { notIn: ["ai_request", "ai_response"] } },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    cursorEvent
      ? Promise.resolve([])
      : ctx.db.note.findMany({ where: { leadId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 50, include: { author: { select: { id: true, name: true } } } }),
  ]);
  return { events, notes, nextCursor: events.length === limit ? events.at(-1)?.id ?? null : null };
}

// ----------------------------------------------------------------------------- Create / update

export async function createLead(ctx: TenantContext, input: LeadCreateInput) {
  assertCan(ctx, "leads:write");
  const data = leadCreateSchema.parse(input);
  const website = normalizeWebsite(data.website);
  const phone = normalizePhone(data.phone, data.country);
  const dedupeKey = dedupeKeyFor({ website, phone, name: data.name, city: data.city, country: data.country });
  const existing = await ctx.db.lead.findFirst({ where: { dedupeKey, deletedAt: null }, select: { id: true, name: true } });
  if (existing) throw new ConflictError(`This business already exists as "${existing.name}"`, { leadId: existing.id });

  await consumeUsage(ctx, "LEAD_CREDITS", 1, { sourceType: "manual", idempotencyKey: `manual:${dedupeKey}` });
  const lead = await ctx.db.lead.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      dedupeKey,
      category: data.category ?? null,
      industry: data.industry ?? null,
      website,
      domain: normalizeDomain(website),
      phone,
      email: normalizeEmail(data.email),
      address: data.address ?? null,
      city: data.city ?? null,
      region: data.region ?? null,
      country: data.country ?? null,
      description: data.description ?? null,
      tags: data.tags ?? [],
      sourceType: "MANUAL",
      sourceProvider: "manual",
      ownerId: ctx.userId,
    },
  });
  if (data.contact && (data.contact.email || data.contact.phone || data.contact.name)) {
    await ctx.db.contact.create({
      data: {
        organizationId: ctx.organizationId,
        leadId: lead.id,
        kind: data.contact.name ? "PERSON" : "GENERIC",
        name: data.contact.name ?? null,
        title: data.contact.title ?? null,
        email: normalizeEmail(data.contact.email),
        phone: normalizePhone(data.contact.phone, data.country),
        source: "manual",
        isPrimary: true,
      },
    });
  }
  await ctx.db.leadSource.create({
    data: { organizationId: ctx.organizationId, leadId: lead.id, sourceType: "MANUAL", provider: "manual", externalId: lead.id, rawData: { createdBy: ctx.userId } },
  });
  await recordEvent(ctx, { type: "lead_created", leadId: lead.id, properties: { source: "manual" }, idempotencyKey: `lead_created:${lead.id}` });
  await getQueue().enqueue("leads.enrich", { organizationId: ctx.organizationId, leadId: lead.id, thenScore: true });
  return lead;
}

export async function changeLeadStatus(ctx: TenantContext, leadId: string, status: LeadStatus, reason?: string) {
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, status: true, email: true, phone: true, domain: true } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  if (lead.status === status) return;
  if (lead.status === "DO_NOT_CONTACT") {
    // Leaving the do-not-contact list is an explicit, audited compliance action.
    throw new PreconditionError("This lead is on the do-not-contact list. Remove the suppression in Settings → Compliance first.");
  }
  if (status === "DO_NOT_CONTACT") {
    await addSuppression(ctx, { leadId, email: lead.email, phone: lead.phone }, { reason: "MANUAL", note: reason, sourceType: "lead_status" });
  } else {
    await ctx.db.lead.update({ where: { id: leadId }, data: { status } });
  }
  await recordEvent(ctx, {
    type: "lead_status_changed",
    leadId,
    properties: { from: lead.status, to: status, fromLabel: LEAD_STATUS_LABELS[lead.status], toLabel: LEAD_STATUS_LABELS[status], reason: reason ?? null },
  });
}

export async function updateLead(ctx: TenantContext, leadId: string, input: LeadUpdateInput) {
  assertCan(ctx, "leads:write");
  const data = leadUpdateSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  if (data.status && data.status !== lead.status) await changeLeadStatus(ctx, leadId, data.status);
  if (data.ownerId) {
    const member = await ctx.db.membership.findFirst({ where: { userId: data.ownerId } });
    if (!member) throw new ValidationError("Owner must be a member of this workspace");
  }
  const website = data.website !== undefined ? normalizeWebsite(data.website) : undefined;
  const updated = await ctx.db.lead.update({
    where: { id: leadId },
    data: {
      name: data.name,
      category: data.category,
      industry: data.industry,
      website,
      domain: website !== undefined ? normalizeDomain(website) : undefined,
      phone: data.phone !== undefined ? normalizePhone(data.phone, lead.country) : undefined,
      email: data.email !== undefined ? normalizeEmail(data.email) : undefined,
      address: data.address,
      city: data.city,
      description: data.description,
      ownerId: data.ownerId,
      tags: data.tags,
      nextAction: data.nextAction,
      nextActionAt: data.nextActionAt,
    },
  });
  await audit(ctx, { action: "lead.updated", resourceType: "lead", resourceId: leadId, metadata: { fields: Object.keys(data) } });
  return updated;
}

export async function deleteLeads(ctx: TenantContext, ids: string[]) {
  assertCan(ctx, "leads:delete");
  const result = await ctx.db.lead.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
  await ctx.db.campaignLead.updateMany({
    where: { leadId: { in: ids }, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } },
    data: { status: "STOPPED", stoppedReason: "Lead deleted", nextActionAt: null },
  });
  await audit(ctx, { action: "lead.deleted", resourceType: "lead", metadata: { count: result.count, ids: ids.slice(0, 50) } });
  return result.count;
}

// ----------------------------------------------------------------------------- Bulk

export async function bulkLeadAction(ctx: TenantContext, input: BulkLeadAction) {
  const action = bulkLeadActionSchema.parse(input);
  switch (action.action) {
    case "status": {
      assertCan(ctx, "leads:write");
      for (const id of action.ids) await changeLeadStatus(ctx, id, action.status);
      return { affected: action.ids.length };
    }
    case "do_not_contact": {
      assertCan(ctx, "leads:write");
      for (const id of action.ids) await changeLeadStatus(ctx, id, "DO_NOT_CONTACT", "Bulk action");
      return { affected: action.ids.length };
    }
    case "delete":
      return { affected: await deleteLeads(ctx, action.ids) };
    case "rescore": {
      assertCan(ctx, "leads:write");
      const leads = await ctx.db.lead.findMany({ where: { id: { in: action.ids }, deletedAt: null }, select: { id: true } });
      for (const lead of leads) await getQueue().enqueue("leads.score", { organizationId: ctx.organizationId, leadId: lead.id }, { jobId: `score:${lead.id}:${Date.now()}` });
      return { affected: leads.length, queued: true };
    }
    case "assign": {
      assertCan(ctx, "leads:write");
      if (action.ownerId && !(await ctx.db.membership.findFirst({ where: { userId: action.ownerId } }))) throw new ValidationError("Owner must be a workspace member");
      const result = await ctx.db.lead.updateMany({ where: { id: { in: action.ids }, deletedAt: null }, data: { ownerId: action.ownerId } });
      return { affected: result.count };
    }
    case "tag": {
      assertCan(ctx, "leads:write");
      const leads = await ctx.db.lead.findMany({ where: { id: { in: action.ids }, deletedAt: null }, select: { id: true, tags: true } });
      await ctx.db.$transaction(
        leads.filter((lead) => !lead.tags.includes(action.tag)).map((lead) => ctx.db.lead.update({ where: { id: lead.id }, data: { tags: [...lead.tags, action.tag] } })),
      );
      return { affected: leads.length };
    }
    case "add_to_campaign": {
      const { addLeadsToCampaign } = await import("../campaigns/audience");
      return addLeadsToCampaign(ctx, action.campaignId, action.ids);
    }
  }
}

// ----------------------------------------------------------------------------- Contacts

export async function addContact(ctx: TenantContext, leadId: string, input: ContactInput) {
  assertCan(ctx, "leads:write");
  const data = contactInputSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, country: true } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  if (!data.name && !data.email && !data.phone) throw new ValidationError("Add a name, email or phone");
  if (data.isPrimary) await ctx.db.contact.updateMany({ where: { leadId }, data: { isPrimary: false } });
  return ctx.db.contact.create({
    data: {
      organizationId: ctx.organizationId,
      leadId,
      kind: data.name ? "PERSON" : "GENERIC",
      name: data.name ?? null,
      title: data.title ?? null,
      email: normalizeEmail(data.email),
      phone: normalizePhone(data.phone, lead.country),
      whatsapp: normalizePhone(data.whatsapp ?? data.phone, lead.country),
      linkedinUrl: data.linkedinUrl ?? null,
      isPrimary: data.isPrimary ?? false,
      whatsappOptIn: data.whatsappOptIn ?? false,
      whatsappOptInAt: data.whatsappOptIn ? new Date() : null,
      source: "manual",
    },
  });
}

export async function updateContact(ctx: TenantContext, contactId: string, input: ContactInput) {
  assertCan(ctx, "leads:write");
  const data = contactInputSchema.parse(input);
  const contact = await ctx.db.contact.findFirst({ where: { id: contactId, deletedAt: null }, include: { lead: { select: { country: true } } } });
  if (!contact) throw new NotFoundError("Contact", contactId);
  if (data.isPrimary) await ctx.db.contact.updateMany({ where: { leadId: contact.leadId }, data: { isPrimary: false } });
  return ctx.db.contact.update({
    where: { id: contactId },
    data: {
      name: data.name,
      title: data.title,
      email: data.email !== undefined ? normalizeEmail(data.email) : undefined,
      phone: data.phone !== undefined ? normalizePhone(data.phone, contact.lead.country) : undefined,
      whatsapp: data.whatsapp !== undefined ? normalizePhone(data.whatsapp, contact.lead.country) : undefined,
      linkedinUrl: data.linkedinUrl,
      isPrimary: data.isPrimary,
      whatsappOptIn: data.whatsappOptIn,
      whatsappOptInAt: data.whatsappOptIn === true && !contact.whatsappOptIn ? new Date() : undefined,
    },
  });
}

export async function deleteContact(ctx: TenantContext, contactId: string) {
  assertCan(ctx, "leads:write");
  const result = await ctx.db.contact.updateMany({ where: { id: contactId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!result.count) throw new NotFoundError("Contact", contactId);
}

// ----------------------------------------------------------------------------- Notes

export async function addNote(ctx: TenantContext, input: { leadId?: string | null; dealId?: string | null; body: string }) {
  assertCan(ctx, "crm:write");
  const body = input.body.trim();
  if (!body) throw new ValidationError("Note can't be empty");
  if (body.length > 10_000) throw new ValidationError("Note is too long");
  if (input.leadId && !(await ctx.db.lead.findFirst({ where: { id: input.leadId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError("Lead", input.leadId);
  const note = await ctx.db.note.create({
    data: { organizationId: ctx.organizationId, leadId: input.leadId ?? null, dealId: input.dealId ?? null, body, authorId: ctx.userId },
    include: { author: { select: { id: true, name: true } } },
  });
  await recordEvent(ctx, { type: "note_added", leadId: input.leadId ?? null, dealId: input.dealId ?? null, properties: { noteId: note.id, preview: body.slice(0, 120) } });
  return note;
}

export async function deleteNote(ctx: TenantContext, noteId: string) {
  assertCan(ctx, "crm:write");
  const note = await ctx.db.note.findFirst({ where: { id: noteId, deletedAt: null } });
  if (!note) throw new NotFoundError("Note", noteId);
  if (note.authorId !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw new ValidationError("Only the author or an admin can delete this note");
  await ctx.db.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
}

// ----------------------------------------------------------------------------- Export / import

export async function exportLeadsCsv(ctx: TenantContext, input: LeadListQueryInput): Promise<{ filename: string; csv: string; count: number }> {
  assertCan(ctx, "leads:export");
  const query = leadListQuerySchema.parse({ ...input, page: 1, pageSize: 200 });
  const where = whereFromQuery(query);
  const rows = await ctx.db.lead.findMany({
    where,
    orderBy: orderFromQuery(query),
    take: 10_000,
    include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: "desc" }, take: 1 }, primaryCampaign: { select: { name: true } } },
  });
  const headers = ["Name", "Score", "Fit", "Status", "Category", "Industry", "City", "Locality", "Address", "Website", "Email", "Phone", "Contact name", "Contact title", "Source", "Campaign", "Last activity", "Created"];
  const csv = toCsv(
    headers,
    rows.map((lead) => [
      lead.name, lead.score, lead.fitTier, LEAD_STATUS_LABELS[lead.status], lead.category, lead.industry, lead.city, lead.locality, lead.address,
      lead.website, lead.email ?? lead.contacts[0]?.email, lead.phone ?? lead.contacts[0]?.phone, lead.contacts[0]?.name, lead.contacts[0]?.title,
      lead.sourceProvider, lead.primaryCampaign?.name, lead.lastActivityAt, lead.createdAt,
    ]),
  );
  await audit(ctx, { action: "lead.exported", resourceType: "lead", metadata: { count: rows.length } });
  return { filename: `leads-${new Date().toISOString().slice(0, 10)}.csv`, csv, count: rows.length };
}

export async function createImport(ctx: TenantContext, input: ImportRequest) {
  assertCan(ctx, "leads:write");
  const data = importRequestSchema.parse(input);
  if (data.campaignId && !(await ctx.db.campaign.findFirst({ where: { id: data.campaignId, deletedAt: null }, select: { id: true } }))) {
    throw new NotFoundError("Campaign", data.campaignId);
  }
  const job = await ctx.db.importJob.create({
    data: {
      organizationId: ctx.organizationId,
      fileName: data.fileName,
      mapping: data.mapping as Prisma.InputJsonValue,
      sourceData: data.csv,
      campaignId: data.campaignId ?? null,
      createdById: ctx.userId,
    },
  });
  await getQueue().enqueue("leads.import", { organizationId: ctx.organizationId, importJobId: job.id }, { jobId: `import:${job.id}` });
  return { id: job.id, status: job.status };
}

export async function getImport(ctx: TenantContext, id: string) {
  assertCan(ctx, "leads:read");
  const job = await ctx.db.importJob.findFirst({ where: { id }, omit: { sourceData: true } });
  if (!job) throw new NotFoundError("Import", id);
  return job;
}

