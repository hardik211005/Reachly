import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";

export const quoteSettingsSchema = z.object({
  numberPrefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only"),
  validityDays: z.number().int().min(1).max(365),
  legalName: z.string().trim().max(200).nullable(),
  address: z.string().trim().max(500).nullable(),
  taxId: z.string().trim().max(40).nullable(),
  email: z.email().max(200).nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(40).nullable(),
  terms: z.string().trim().max(4000).nullable(),
  footer: z.string().trim().max(500).nullable(),
}).partial();

const DEFAULT_TERMS = "Prices exclude any taxes not listed. 50% payable on acceptance, balance on delivery. This quote is valid until the date shown.";

/** The workspace's quote settings, created with sensible defaults on first use. */
export async function getQuoteSettings(ctx: TenantContext) {
  const existing = await ctx.db.quoteSettings.findFirst({});
  if (existing) return existing;
  const profile = await ctx.db.businessProfile.findFirst({ select: { name: true, city: true, region: true, country: true } });
  return ctx.db.quoteSettings.upsert({
    where: { organizationId: ctx.organizationId },
    create: {
      organizationId: ctx.organizationId,
      legalName: profile?.name ?? null,
      address: [profile?.city, profile?.region, profile?.country].filter(Boolean).join(", ") || null,
      terms: DEFAULT_TERMS,
    },
    update: {},
  });
}

export async function updateQuoteSettings(ctx: TenantContext, input: z.input<typeof quoteSettingsSchema>) {
  assertCan(ctx, "workspace:manage");
  const data = quoteSettingsSchema.parse(input);
  await getQuoteSettings(ctx);
  const updated = await ctx.db.quoteSettings.update({ where: { organizationId: ctx.organizationId }, data });
  await audit(ctx, { action: "quote_settings.updated", resourceType: "quote_settings", resourceId: updated.id, metadata: { fields: Object.keys(data) } });
  return updated;
}

/** Reserves the next quote number atomically (Q-2026-0007). */
export async function nextQuoteNumber(ctx: TenantContext, now = new Date()): Promise<string> {
  await getQuoteSettings(ctx);
  const settings = await ctx.db.quoteSettings.update({ where: { organizationId: ctx.organizationId }, data: { nextNumber: { increment: 1 } } });
  return `${settings.numberPrefix}-${now.getFullYear()}-${String(settings.nextNumber - 1).padStart(4, "0")}`;
}
