import type { Prisma } from "@repo/db";
import { z } from "zod";
import { assertResourceLimit } from "../billing/plans";
import type { TenantContext } from "../context";
import { NotFoundError, ForbiddenError } from "../errors";
import { searchCriteriaSchema } from "../discovery/schemas";

// ----------------------------------------------------------------------------- Saved searches (discovery)

export const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().max(500).default(""),
  criteria: searchCriteriaSchema,
});

export async function listSavedSearches(ctx: TenantContext) {
  return ctx.db.savedSearch.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function createSavedSearch(ctx: TenantContext, input: z.input<typeof savedSearchSchema>) {
  const data = savedSearchSchema.parse(input);
  await assertResourceLimit(ctx, "savedSearches", await ctx.db.savedSearch.count());
  return ctx.db.savedSearch.create({
    data: { organizationId: ctx.organizationId, name: data.name, query: data.query, criteria: data.criteria as unknown as Prisma.InputJsonValue, createdById: ctx.userId },
  });
}

export async function deleteSavedSearch(ctx: TenantContext, id: string) {
  const result = await ctx.db.savedSearch.deleteMany({ where: { id } });
  if (!result.count) throw new NotFoundError("Saved search", id);
}

// ----------------------------------------------------------------------------- Saved views (tables)

export const savedViewSchema = z.object({
  resource: z.string().trim().min(1).max(40).default("leads"),
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: z.object({ field: z.string().max(40), order: z.enum(["asc", "desc"]) }).nullable().default(null),
  columns: z.array(z.string().max(40)).max(30).default([]),
  isShared: z.boolean().default(false),
});

export async function listSavedViews(ctx: TenantContext, resource: string) {
  return ctx.db.savedView.findMany({
    where: { resource, OR: [{ userId: ctx.userId }, { isShared: true }] },
    orderBy: { createdAt: "asc" },
  });
}

export async function createSavedView(ctx: TenantContext, input: z.input<typeof savedViewSchema>) {
  const data = savedViewSchema.parse(input);
  return ctx.db.savedView.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      resource: data.resource,
      name: data.name,
      filters: data.filters as Prisma.InputJsonValue,
      sort: (data.sort ?? {}) as Prisma.InputJsonValue,
      columns: data.columns,
      isShared: data.isShared,
    },
  });
}

export async function deleteSavedView(ctx: TenantContext, id: string) {
  const view = await ctx.db.savedView.findFirst({ where: { id } });
  if (!view) throw new NotFoundError("Saved view", id);
  if (view.userId !== ctx.userId && ctx.role !== "OWNER" && ctx.role !== "ADMIN") throw new ForbiddenError("Only the creator or an admin can delete this view");
  await ctx.db.savedView.delete({ where: { id } });
}
