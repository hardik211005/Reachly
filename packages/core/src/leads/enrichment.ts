import type { Prisma } from "@repo/db";
import type { TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { recordEvent } from "../events";
import { logger } from "../logger";
import { normalizeEmail, normalizePhone } from "./normalize";
import { resolveEnrichmentProvider } from "./providers";
import { SIGNAL_CATALOG, isSignalKey, type LeadSignal } from "./signals";

function mergeSignals(existing: LeadSignal[], incoming: LeadSignal[]): LeadSignal[] {
  const byKey = new Map(existing.map((signal) => [signal.key, signal]));
  for (const signal of incoming) {
    const current = byKey.get(signal.key);
    if (!current || signal.weight > current.weight) byKey.set(signal.key, signal);
  }
  // A lead can't be both "no website" and have a weak/strong one; drop contradictions.
  if (byKey.has("weak_website")) byKey.delete("no_website");
  if (byKey.has("active_social")) byKey.delete("no_social_presence");
  return [...byKey.values()];
}

/**
 * Enriches a lead from its source-appropriate provider, then records contact details and
 * buying signals *with the evidence and source* so every derived fact is traceable.
 */
export async function enrichLead(ctx: TenantContext, leadId: string) {
  const lead = await ctx.db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: { contacts: { where: { deletedAt: null } }, sources: { orderBy: { fetchedAt: "asc" }, take: 1 } },
  });
  if (!lead) throw new NotFoundError("Lead", leadId);

  const provider = resolveEnrichmentProvider(lead.sourceProvider);
  await ctx.db.lead.update({ where: { id: lead.id }, data: { enrichmentStatus: "ENRICHING" } });

  const contactsToCreate: Prisma.ContactCreateManyInput[] = [];
  const hasContact = (field: "email" | "phone", value: string) =>
    lead.contacts.some((contact) => contact[field] === value) || contactsToCreate.some((contact) => contact[field] === value);

  // Listing phone/email become a generic contact even without an enrichment provider.
  if (lead.phone && !hasContact("phone", lead.phone)) {
    contactsToCreate.push({ organizationId: ctx.organizationId, leadId: lead.id, kind: "GENERIC", phone: lead.phone, whatsapp: lead.phone, source: lead.sourceProvider, isPrimary: lead.contacts.length === 0 });
  }

  if (!provider) {
    if (contactsToCreate.length) await ctx.db.contact.createMany({ data: contactsToCreate });
    await ctx.db.lead.update({ where: { id: lead.id }, data: { enrichmentStatus: "SKIPPED" } });
    return { status: "SKIPPED" as const };
  }

  try {
    const result = await provider.enrich({
      name: lead.name,
      website: lead.website,
      domain: lead.domain,
      city: lead.city,
      category: lead.category,
      phone: lead.phone,
      email: lead.email,
      sourceProvider: lead.sourceProvider,
      raw: (lead.sources[0]?.rawData ?? {}) as Record<string, unknown>,
    });

    const emails = result.emails.map((email) => normalizeEmail(email.value)).filter((email): email is string => Boolean(email));
    const primaryEmail = lead.email ?? emails[0] ?? null;

    for (const contact of result.contacts) {
      const email = normalizeEmail(contact.email);
      const phone = normalizePhone(contact.phone, lead.country);
      if ((email && hasContact("email", email)) || (phone && hasContact("phone", phone))) continue;
      contactsToCreate.push({
        organizationId: ctx.organizationId,
        leadId: lead.id,
        kind: contact.name ? "PERSON" : "GENERIC",
        name: contact.name,
        title: contact.title,
        email,
        phone,
        source: contact.source,
        isPrimary: Boolean(contact.name) && !lead.contacts.some((existing) => existing.isPrimary && existing.kind === "PERSON"),
      });
    }
    for (const email of emails) {
      if (!hasContact("email", email)) {
        contactsToCreate.push({ organizationId: ctx.organizationId, leadId: lead.id, kind: "GENERIC", email, source: provider.name });
      }
    }

    const incoming: LeadSignal[] = result.signals
      .filter((signal) => isSignalKey(signal.key))
      .map((signal) => ({
        key: signal.key,
        label: isSignalKey(signal.key) ? SIGNAL_CATALOG[signal.key].label : signal.key,
        weight: Math.max(0, Math.min(1, signal.weight)),
        evidence: signal.evidence,
        source: signal.source,
      }));
    if ((lead.reviewCount ?? 0) >= 200) incoming.push({ key: "high_review_volume", label: SIGNAL_CATALOG.high_review_volume.label, weight: 0.7, evidence: `${lead.reviewCount} reviews`, source: lead.sourceProvider });
    else if (lead.reviewCount !== null && lead.reviewCount < 25) incoming.push({ key: "few_reviews", label: SIGNAL_CATALOG.few_reviews.label, weight: 0.6, evidence: `${lead.reviewCount} reviews`, source: lead.sourceProvider });
    if ((lead.priceLevel ?? 0) >= 3) incoming.push({ key: "premium_positioning", label: SIGNAL_CATALOG.premium_positioning.label, weight: 0.5, evidence: "Higher price level", source: lead.sourceProvider });

    const signals = mergeSignals((Array.isArray(lead.signals) ? lead.signals : []) as unknown as LeadSignal[], incoming);
    const socialProfiles = { ...((lead.socialProfiles ?? {}) as Record<string, string>), ...result.socialProfiles };

    await ctx.db.$transaction([
      ...(contactsToCreate.length ? [ctx.db.contact.createMany({ data: contactsToCreate })] : []),
      ctx.db.lead.update({
        where: { id: lead.id },
        data: {
          email: primaryEmail,
          description: lead.description ?? result.description,
          services: lead.services.length ? lead.services : result.services,
          socialProfiles,
          signals: signals as unknown as Prisma.InputJsonValue,
          locationsCount: result.locationsCount ?? lead.locationsCount,
          employeeRange: result.employeeRange ?? lead.employeeRange,
          enrichmentStatus: "ENRICHED",
          enrichedAt: new Date(),
        },
      }),
    ]);

    await recordEvent(ctx, {
      type: "lead_enriched",
      leadId: lead.id,
      properties: {
        provider: provider.name,
        simulated: provider.isMock,
        contactsAdded: contactsToCreate.length,
        signals: signals.map((signal) => signal.key),
      },
    });
    return { status: "ENRICHED" as const, contactsAdded: contactsToCreate.length, signals: signals.length };
  } catch (error) {
    logger.warn({ err: error, leadId }, "lead enrichment failed");
    if (contactsToCreate.length) await ctx.db.contact.createMany({ data: contactsToCreate }).catch(() => undefined);
    await ctx.db.lead.update({ where: { id: lead.id }, data: { enrichmentStatus: "FAILED" } });
    await recordEvent(ctx, { type: "lead_enrichment_failed", leadId: lead.id, properties: { provider: provider.name, error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}
