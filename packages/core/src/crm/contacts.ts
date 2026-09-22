import { z } from "zod";
import { assertCan, type TenantContext } from "../context";

export const contactListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Every person across the workspace's companies (leads), for the CRM contacts view. */
export async function listContacts(ctx: TenantContext, input: z.input<typeof contactListSchema> = {}) {
  assertCan(ctx, "crm:read");
  const query = contactListSchema.parse(input);
  const search = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" as const } },
          { email: { contains: query.q, mode: "insensitive" as const } },
          { title: { contains: query.q, mode: "insensitive" as const } },
          { lead: { name: { contains: query.q, mode: "insensitive" as const } } },
        ],
      }
    : {};
  const [contacts, total] = await Promise.all([
    ctx.db.contact.findMany({
      where: { deletedAt: null, kind: "PERSON", lead: { deletedAt: null }, ...search },
      orderBy: [{ updatedAt: "desc" }],
      take: query.limit,
      select: {
        id: true,
        name: true,
        title: true,
        email: true,
        phone: true,
        whatsapp: true,
        isPrimary: true,
        source: true,
        emailVerified: true,
        lead: { select: { id: true, name: true, city: true, status: true } },
      },
    }),
    ctx.db.contact.count({ where: { deletedAt: null, kind: "PERSON", lead: { deletedAt: null }, ...search } }),
  ]);
  return { contacts, total };
}
