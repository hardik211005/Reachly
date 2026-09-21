import type { Contact, Lead, Offering } from "@repo/db";
import type { OutreachLeadContext, OutreachSellerContext } from "../ai/agents/outreach";
import type { TenantContext } from "../context";
import type { LeadSignal } from "../leads/signals";

/** Pricing statements built ONLY from configured offerings — the AI may not invent others. */
export function pricingFacts(offerings: Offering[]): string[] {
  return offerings
    .filter((offering) => offering.unitPrice !== null && offering.isActive && !offering.deletedAt)
    .slice(0, 4)
    .map((offering) => {
      const amount = Number(offering.unitPrice);
      const price = new Intl.NumberFormat(offering.currency === "INR" ? "en-IN" : "en", {
        style: "currency",
        currency: offering.currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
      const moq = offering.minOrderQuantity ? `, minimum ${offering.minOrderQuantity.toLocaleString("en-IN")} ${offering.unit}s` : "";
      return `${offering.name}: ${price} per ${offering.unit}${moq}`;
    });
}

export function primaryContact(contacts: Contact[], channel: "EMAIL" | "WHATSAPP" | "PHONE"): Contact | null {
  const usable = contacts.filter((contact) => !contact.deletedAt);
  const has = (contact: Contact) => (channel === "EMAIL" ? Boolean(contact.email) : Boolean(contact.whatsapp ?? contact.phone));
  return (
    usable.find((contact) => contact.isPrimary && contact.kind === "PERSON" && has(contact)) ??
    usable.find((contact) => contact.kind === "PERSON" && has(contact)) ??
    usable.find(has) ??
    null
  );
}

export function leadContext(lead: Lead & { contacts: Contact[] }): OutreachLeadContext {
  const person = lead.contacts.find((contact) => contact.kind === "PERSON" && !contact.deletedAt) ?? null;
  const signals = (Array.isArray(lead.signals) ? lead.signals : []) as unknown as LeadSignal[];
  return {
    name: lead.name,
    category: lead.category,
    locality: lead.locality,
    city: lead.city,
    description: lead.description,
    services: lead.services,
    rating: lead.rating ? Number(lead.rating) : null,
    reviewCount: lead.reviewCount,
    locationsCount: lead.locationsCount,
    signals: signals.map((signal) => ({ key: signal.key, label: signal.label, evidence: signal.evidence })),
    contactName: person?.name ?? null,
    contactTitle: person?.title ?? null,
  };
}

export async function sellerContext(
  ctx: TenantContext,
  options: { offer?: string | null; pitchAngle?: string | null; offeringIds?: string[]; includePricing?: boolean } = {},
): Promise<OutreachSellerContext> {
  const [profile, org, user, offerings] = await Promise.all([
    ctx.db.businessProfile.findFirst(),
    ctx.db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    ctx.userId ? ctx.db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : Promise.resolve(null),
    ctx.db.offering.findMany({
      where: { deletedAt: null, isActive: true, ...(options.offeringIds?.length ? { id: { in: options.offeringIds } } : {}) },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const owner = user ?? (await ctx.db.membership.findFirst({ where: { role: "OWNER" }, include: { user: { select: { name: true } } } }))?.user ?? null;
  return {
    businessName: profile?.name ?? org?.name ?? "our team",
    senderName: owner?.name?.split(" ")[0] ?? profile?.name ?? "The team",
    description: profile?.description ?? "",
    valueProposition: profile?.valueProposition ?? null,
    offer: options.offer ?? offerings[0]?.name ?? null,
    pitchAngle: options.pitchAngle ?? null,
    pricingFacts: options.includePricing ? pricingFacts(offerings) : [],
  };
}
