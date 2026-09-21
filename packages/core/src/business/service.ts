import type { Prisma } from "@repo/db";
import { businessUnderstandingAgent, type BusinessUnderstandingInput } from "../ai/agents/business-understanding";
import { runAgent } from "../ai/service";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, PreconditionError } from "../errors";
import {
  businessProfileInputSchema,
  icpSchema,
  offeringInputSchema,
  type BusinessProfileInput,
  type Icp,
  type OfferingInput,
} from "./schemas";

export async function getBusinessProfile(ctx: TenantContext) {
  return ctx.db.businessProfile.findFirst();
}

export async function upsertBusinessProfile(ctx: TenantContext, input: BusinessProfileInput) {
  assertCan(ctx, "workspace:manage");
  const data = businessProfileInputSchema.parse(input);
  const values = {
    name: data.name,
    website: data.website ?? null,
    industry: data.industry,
    description: data.description,
    city: data.city ?? null,
    region: data.region ?? null,
    country: data.country ?? null,
    businessSize: data.businessSize,
    pricingModel: data.pricingModel ?? null,
    targetIndustries: data.targetIndustries,
    targetCustomerTypes: data.targetCustomerTypes,
    valueProposition: data.valueProposition ?? null,
    outreachTone: data.outreachTone,
    preferredChannels: data.preferredChannels,
  };
  const existing = await ctx.db.businessProfile.findFirst({ select: { id: true } });
  const profile = existing
    ? await ctx.db.businessProfile.update({ where: { id: existing.id }, data: values })
    : await ctx.db.businessProfile.create({ data: { ...values, organizationId: ctx.organizationId } });
  await audit(ctx, { action: "business_profile.saved", resourceType: "business_profile", resourceId: profile.id });
  return profile;
}

export async function listOfferings(ctx: TenantContext) {
  return ctx.db.offering.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
}

function offeringValues(input: OfferingInput) {
  const data = offeringInputSchema.parse(input);
  return {
    type: data.type,
    name: data.name,
    description: data.description ?? null,
    unit: data.unit,
    unitPrice: data.unitPrice ?? null,
    currency: data.currency,
    minOrderQuantity: data.minOrderQuantity ?? null,
    setupFee: data.setupFee ?? null,
    taxRatePercent: data.taxRatePercent ?? null,
    sku: data.sku ?? null,
    isActive: data.isActive,
  };
}

export async function createOffering(ctx: TenantContext, input: OfferingInput) {
  assertCan(ctx, "workspace:manage");
  return ctx.db.offering.create({ data: { ...offeringValues(input), organizationId: ctx.organizationId } });
}

export async function updateOffering(ctx: TenantContext, id: string, input: OfferingInput) {
  assertCan(ctx, "workspace:manage");
  const existing = await ctx.db.offering.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError("Offering", id);
  return ctx.db.offering.update({ where: { id }, data: offeringValues(input) });
}

export async function deleteOffering(ctx: TenantContext, id: string) {
  assertCan(ctx, "workspace:manage");
  const existing = await ctx.db.offering.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new NotFoundError("Offering", id);
  await ctx.db.offering.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

/** Replaces the offering list in one go (used by onboarding). */
export async function replaceOfferings(ctx: TenantContext, inputs: OfferingInput[]) {
  assertCan(ctx, "workspace:manage");
  const values = inputs.map(offeringValues);
  await ctx.db.$transaction([
    ctx.db.offering.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date(), isActive: false } }),
    ctx.db.offering.createMany({ data: values.map((value) => ({ ...value, organizationId: ctx.organizationId })) }),
  ]);
  return listOfferings(ctx);
}

/** Runs the Business Understanding Agent and stores the resulting ICP on the profile. */
export async function analyzeBusiness(ctx: TenantContext, options: { fresh?: boolean } = {}) {
  assertCan(ctx, "ai:use");
  const profile = await ctx.db.businessProfile.findFirst();
  if (!profile) throw new PreconditionError("Save your business profile before analysing it");
  const offerings = await listOfferings(ctx);

  const input: BusinessUnderstandingInput = {
    name: profile.name,
    website: profile.website,
    industry: profile.industry,
    description: profile.description,
    city: profile.city,
    region: profile.region,
    country: profile.country,
    businessSize: profile.businessSize,
    pricingModel: profile.pricingModel,
    targetIndustries: profile.targetIndustries,
    targetCustomerTypes: profile.targetCustomerTypes,
    offerings: offerings.map((offering) => ({
      type: offering.type,
      name: offering.name,
      description: offering.description,
      unitPrice: offering.unitPrice ? Number(offering.unitPrice) : null,
      currency: offering.currency,
      minOrderQuantity: offering.minOrderQuantity,
    })),
  };

  const { output, meta } = await runAgent(ctx, businessUnderstandingAgent, input, { fresh: options.fresh });
  const updated = await ctx.db.businessProfile.update({
    where: { id: profile.id },
    data: {
      icp: output as Prisma.InputJsonValue,
      aiAnalyzedAt: new Date(),
      valueProposition: profile.valueProposition ?? output.valueProposition,
    },
  });
  return { profile: updated, icp: output, meta };
}

export async function updateIcp(ctx: TenantContext, icp: Icp) {
  assertCan(ctx, "workspace:manage");
  const parsed = icpSchema.parse(icp);
  const profile = await ctx.db.businessProfile.findFirst({ select: { id: true } });
  if (!profile) throw new NotFoundError("Business profile");
  await audit(ctx, { action: "icp.updated", resourceType: "business_profile", resourceId: profile.id });
  return ctx.db.businessProfile.update({ where: { id: profile.id }, data: { icp: parsed as Prisma.InputJsonValue } });
}

export function readIcp(value: unknown): Icp | null {
  const parsed = icpSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function completeOnboarding(ctx: TenantContext) {
  const profile = await ctx.db.businessProfile.findFirst({ select: { id: true } });
  if (!profile) throw new PreconditionError("Complete your business profile first");
  // Organization is the tenant row itself (not tenant-scoped), so target it explicitly by id.
  await ctx.db.organization.update({ where: { id: ctx.organizationId }, data: { onboardingCompleted: true } });
  await audit(ctx, { action: "onboarding.completed", resourceType: "organization", resourceId: ctx.organizationId });
}
