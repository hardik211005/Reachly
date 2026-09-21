import { createLead, listLeads } from "@repo/core/leads/service";
import { leadCreateSchema, leadListQuerySchema } from "@repo/core/leads/schemas";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: leadListQuerySchema, permission: "leads:read" }, async ({ ctx, query }) => {
  const result = await listLeads(ctx, query);
  return ok(result.items, { total: result.total, page: result.page, pageSize: result.pageSize, facets: result.facets });
});

export const POST = route({ body: leadCreateSchema, permission: "leads:write" }, async ({ ctx, body }) => created(await createLead(ctx, body)));
