import { z } from "zod";
import { upsertBusinessProfile, replaceOfferings, completeOnboarding } from "../business/service";
import { businessProfileInputSchema, offeringInputSchema } from "../business/schemas";
import { createCampaign } from "../campaigns/service";
import { campaignInputSchema } from "../campaigns/schemas";
import { createTenantContext, type TenantContext } from "../context";
import { createOrganization, resolveMembership } from "../organizations/service";

export const onboardingBusinessSchema = z.object({
  profile: businessProfileInputSchema,
  offerings: z.array(offeringInputSchema).min(1, "Add at least one product or service").max(30),
  /** Create an additional workspace instead of updating the current one. */
  newWorkspace: z.boolean().default(false),
  currency: z.string().length(3).default("INR"),
  timezone: z.string().min(1).max(64).default("Asia/Kolkata"),
});
export type OnboardingBusinessInput = z.input<typeof onboardingBusinessSchema>;

/**
 * Step 2 of onboarding: creates the workspace on first run (named after the business),
 * then saves the business profile and catalogue.
 */
export async function saveOnboardingBusiness(userId: string, input: OnboardingBusinessInput) {
  const data = onboardingBusinessSchema.parse(input);
  let ctx: TenantContext;
  const existing = await resolveMembership(userId);
  if (!existing || data.newWorkspace) {
    const org = await createOrganization({
      userId,
      name: data.profile.name,
      currency: data.currency,
      timezone: data.timezone,
      country: data.profile.country ?? undefined,
    });
    ctx = createTenantContext({ organizationId: org.id, userId, role: "OWNER" });
  } else {
    ctx = createTenantContext({ organizationId: existing.organizationId, userId, role: existing.role });
    await ctx.db.organization.update({
      where: { id: ctx.organizationId },
      data: { currency: data.currency, timezone: data.timezone },
    });
  }
  const profile = await upsertBusinessProfile(ctx, data.profile);
  const offerings = await replaceOfferings(ctx, data.offerings.map((offering) => ({ ...offering, currency: offering.currency ?? data.currency })));
  return { organizationId: ctx.organizationId, profile, offerings };
}

export const onboardingCompleteSchema = z.object({
  campaign: campaignInputSchema.nullable(),
});

/** Final step: optionally creates the first (draft) campaign and marks onboarding done. */
export async function finishOnboarding(ctx: TenantContext, input: z.input<typeof onboardingCompleteSchema>) {
  const data = onboardingCompleteSchema.parse(input);
  const campaign = data.campaign ? await createCampaign(ctx, data.campaign) : null;
  await completeOnboarding(ctx);
  return { campaignId: campaign?.id ?? null };
}
