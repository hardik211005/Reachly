import { z } from "zod";
import { USD_EXCHANGE_RATE } from "@repo/config";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";

/** Currencies with a configured exchange rate (costs are converted from USD with it). */
export const WORKSPACE_CURRENCIES = Object.keys(USD_EXCHANGE_RATE);

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(80),
  timezone: z.string().refine(isTimeZone, "Choose a valid time zone"),
  currency: z.string().refine((value) => WORKSPACE_CURRENCIES.includes(value), "Choose a supported currency"),
  country: z.string().trim().max(60).nullish(),
});
export type WorkspaceSettingsInput = z.input<typeof workspaceSettingsSchema>;

export async function getWorkspaceSettings(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const organization = await ctx.db.organization.findFirst({ where: { id: ctx.organizationId, deletedAt: null }, select: { id: true, name: true, slug: true, timezone: true, currency: true, country: true, createdAt: true } });
  if (!organization) throw new NotFoundError("Workspace", ctx.organizationId);
  return { ...organization, currencies: WORKSPACE_CURRENCIES };
}

export async function updateWorkspaceSettings(ctx: TenantContext, input: WorkspaceSettingsInput) {
  assertCan(ctx, "workspace:manage");
  const data = workspaceSettingsSchema.parse(input);
  const before = await ctx.db.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true, timezone: true, currency: true, country: true } });
  if (!before) throw new NotFoundError("Workspace", ctx.organizationId);
  const updated = await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { name: data.name, timezone: data.timezone, currency: data.currency, country: data.country ?? null } });
  const changed = (Object.keys(data) as Array<keyof typeof data>).filter((key) => (data[key] ?? null) !== (before[key] ?? null));
  if (changed.length) await audit(ctx, { action: "workspace.updated", resourceType: "organization", resourceId: ctx.organizationId, metadata: { changed } });
  return { id: updated.id, name: updated.name, slug: updated.slug, timezone: updated.timezone, currency: updated.currency, country: updated.country };
}
