import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { describeRule, type CatalogOffering, type CatalogRule, type PricingRuleType } from "./pricing";

/** Offerings (products, services, packages) and the pricing rules quotes are built from. */

export const PRICING_RULE_TYPES = ["VOLUME_DISCOUNT_PERCENT", "PERCENT_DISCOUNT", "FIXED_DISCOUNT", "MIN_QUANTITY", "SETUP_FEE_WAIVER"] as const satisfies readonly PricingRuleType[];

export const PRICING_RULE_META: Record<PricingRuleType, { label: string; description: string; valueLabel: string | null }> = {
  VOLUME_DISCOUNT_PERCENT: { label: "Volume discount", description: "A percentage off from a quantity. Only the best matching tier applies.", valueLabel: "% off" },
  PERCENT_DISCOUNT: { label: "Percentage discount", description: "A percentage off, e.g. a launch offer. Stacks with a volume tier.", valueLabel: "% off" },
  FIXED_DISCOUNT: { label: "Fixed discount", description: "A fixed amount off each matching line.", valueLabel: "Amount off" },
  MIN_QUANTITY: { label: "Minimum order", description: "Blocks sending a quote below this quantity.", valueLabel: "Minimum quantity" },
  SETUP_FEE_WAIVER: { label: "Setup fee waiver", description: "Waives the setup fee, usually above a quantity.", valueLabel: null },
};

export const pricingRuleInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    type: z.enum(PRICING_RULE_TYPES),
    offeringId: z.uuid().nullable().default(null),
    minQuantity: z.number().int().positive().nullable().default(null),
    maxQuantity: z.number().int().positive().nullable().default(null),
    value: z.number().nonnegative().max(100_000_000).default(0),
    priority: z.number().int().min(0).max(100).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((rule) => !(rule.type.endsWith("PERCENT") || rule.type === "PERCENT_DISCOUNT") || rule.value <= 100, { message: "A percentage can't be more than 100", path: ["value"] })
  .refine((rule) => rule.type !== "MIN_QUANTITY" || rule.value >= 1, { message: "Set the minimum quantity", path: ["value"] })
  .refine((rule) => rule.minQuantity === null || rule.maxQuantity === null || rule.maxQuantity >= rule.minQuantity, { message: "Max quantity must be at least the min", path: ["maxQuantity"] });
export type PricingRuleInput = z.input<typeof pricingRuleInputSchema>;

export async function loadCatalog(ctx: TenantContext): Promise<{ offerings: CatalogOffering[]; rules: CatalogRule[] }> {
  const [offerings, rules] = await Promise.all([
    ctx.db.offering.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } }),
    ctx.db.pricingRule.findMany({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
  ]);
  return {
    offerings: offerings.map((offering) => ({
      id: offering.id,
      name: offering.name,
      description: offering.description,
      unit: offering.unit,
      unitPrice: offering.unitPrice === null ? null : Number(offering.unitPrice),
      setupFee: offering.setupFee === null ? null : Number(offering.setupFee),
      taxRatePercent: offering.taxRatePercent === null ? null : Number(offering.taxRatePercent),
      minOrderQuantity: offering.minOrderQuantity,
      currency: offering.currency,
      isActive: offering.isActive,
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      type: rule.type as PricingRuleType,
      offeringId: rule.offeringId,
      minQuantity: rule.minQuantity,
      maxQuantity: rule.maxQuantity,
      value: Number(rule.value),
      priority: rule.priority,
      isActive: rule.isActive,
    })),
  };
}

/** Catalog for the UI: offerings with the rules that apply to them, each rule in plain English. */
export async function getCatalog(ctx: TenantContext) {
  assertCan(ctx, "crm:read");
  const [catalog, org, extra] = await Promise.all([
    loadCatalog(ctx),
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { currency: true } }),
    ctx.db.offering.findMany({ where: { deletedAt: null }, select: { id: true, type: true, sku: true } }),
  ]);
  const byId = new Map(catalog.offerings.map((offering) => [offering.id, offering]));
  const details = new Map(extra.map((offering) => [offering.id, offering]));
  return {
    currency: org.currency,
    offerings: catalog.offerings.map((offering) => ({ ...offering, type: details.get(offering.id)?.type ?? "SERVICE", sku: details.get(offering.id)?.sku ?? null })),
    rules: catalog.rules.map((rule) => {
      const offering = rule.offeringId ? byId.get(rule.offeringId) : null;
      return { ...rule, offeringName: offering?.name ?? null, description: describeRule(rule, offering ? { name: offering.name, unit: offering.unit } : null, org.currency) };
    }),
  };
}

async function assertOffering(ctx: TenantContext, offeringId: string | null) {
  if (offeringId && !(await ctx.db.offering.findFirst({ where: { id: offeringId, deletedAt: null }, select: { id: true } }))) throw new ValidationError("Pick an offering from your catalog");
}

export async function createPricingRule(ctx: TenantContext, input: PricingRuleInput) {
  assertCan(ctx, "workspace:manage");
  const data = pricingRuleInputSchema.parse(input);
  await assertOffering(ctx, data.offeringId);
  const rule = await ctx.db.pricingRule.create({ data: { ...data, organizationId: ctx.organizationId } });
  await audit(ctx, { action: "pricing_rule.created", resourceType: "pricing_rule", resourceId: rule.id, metadata: { name: rule.name, type: rule.type } });
  return rule;
}

export async function updatePricingRule(ctx: TenantContext, id: string, input: PricingRuleInput) {
  assertCan(ctx, "workspace:manage");
  const data = pricingRuleInputSchema.parse(input);
  const existing = await ctx.db.pricingRule.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError("Pricing rule", id);
  await assertOffering(ctx, data.offeringId);
  const rule = await ctx.db.pricingRule.update({ where: { id }, data });
  await audit(ctx, { action: "pricing_rule.updated", resourceType: "pricing_rule", resourceId: id, metadata: { name: rule.name } });
  return rule;
}

export async function deletePricingRule(ctx: TenantContext, id: string) {
  assertCan(ctx, "workspace:manage");
  const existing = await ctx.db.pricingRule.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError("Pricing rule", id);
  await ctx.db.pricingRule.delete({ where: { id } });
  await audit(ctx, { action: "pricing_rule.deleted", resourceType: "pricing_rule", resourceId: id, metadata: { name: existing.name } });
}
