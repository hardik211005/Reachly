import type { TenantContext } from "../context";

export interface SearchResult {
  type: "lead" | "contact" | "campaign" | "conversation" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * Global search (⌘K). Case-insensitive prefix/substring match across the main entities,
 * tenant-scoped through ctx.db. Kept to small result sets per type for snappy UX.
 */
export async function globalSearch(ctx: TenantContext, query: string, limitPerType = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };

  const [leads, contacts, campaigns, deals, conversations] = await Promise.all([
    ctx.db.lead.findMany({
      where: { deletedAt: null, OR: [{ name: contains }, { domain: contains }, { city: contains }, { phone: contains }, { email: contains }] },
      select: { id: true, name: true, city: true, category: true },
      orderBy: [{ score: { sort: "desc", nulls: "last" } }],
      take: limitPerType,
    }),
    ctx.db.contact.findMany({
      where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
      select: { id: true, name: true, email: true, leadId: true, lead: { select: { name: true } } },
      take: limitPerType,
    }),
    ctx.db.campaign.findMany({
      where: { deletedAt: null, name: contains },
      select: { id: true, name: true, status: true },
      take: limitPerType,
    }),
    ctx.db.deal.findMany({
      where: { deletedAt: null, OR: [{ title: contains }, { lead: { name: contains } }] },
      select: { id: true, title: true, stage: true, leadId: true },
      take: limitPerType,
    }),
    ctx.db.conversation.findMany({
      where: { OR: [{ subject: contains }, { lead: { name: contains } }] },
      select: { id: true, subject: true, channel: true, lead: { select: { name: true } } },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: limitPerType,
    }),
  ]);

  return [
    ...leads.map((lead) => ({
      type: "lead" as const,
      id: lead.id,
      title: lead.name,
      subtitle: [lead.category, lead.city].filter(Boolean).join(" · ") || null,
      href: `/app/leads/${lead.id}`,
    })),
    ...contacts.map((contact) => ({
      type: "contact" as const,
      id: contact.id,
      title: contact.name ?? contact.email ?? "Contact",
      subtitle: contact.lead.name,
      href: `/app/leads/${contact.leadId}?tab=contacts`,
    })),
    ...campaigns.map((campaign) => ({
      type: "campaign" as const,
      id: campaign.id,
      title: campaign.name,
      subtitle: campaign.status.toLowerCase(),
      href: `/app/campaigns/${campaign.id}`,
    })),
    ...deals.map((deal) => ({
      type: "deal" as const,
      id: deal.id,
      title: deal.title,
      subtitle: deal.stage.toLowerCase(),
      href: `/app/crm?deal=${deal.id}`,
    })),
    ...conversations.map((conversation) => ({
      type: "conversation" as const,
      id: conversation.id,
      title: conversation.subject ?? conversation.lead.name,
      subtitle: `${conversation.channel.toLowerCase()} · ${conversation.lead.name}`,
      href: `/app/conversations?status=all&c=${conversation.id}`,
    })),
  ];
}
