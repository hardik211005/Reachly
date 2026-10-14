import { z } from "zod";
import { upsertBusinessProfile, replaceOfferings, completeOnboarding } from "../business/service";
import { businessProfileInputSchema, offeringInputSchema } from "../business/schemas";
import { createCampaign } from "../campaigns/service";
import { campaignInputSchema } from "../campaigns/schemas";
import { createTenantContext, type TenantContext } from "../context";
import { prisma } from "@repo/db";
import { runOnboardingAutopilot } from "./autopilot";
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

/**
 * Final step: optionally creates the first (draft) campaign, marks onboarding done, then starts the
 * autopilot (first lead search, standard automations, n8n hand-off) — only the first time.
 */
export async function finishOnboarding(ctx: TenantContext, input: z.input<typeof onboardingCompleteSchema>) {
  const data = onboardingCompleteSchema.parse(input);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { onboardingCompleted: true } });
  const campaign = data.campaign ? await createCampaign(ctx, data.campaign) : null;
  await completeOnboarding(ctx);
  const autopilot = organization.onboardingCompleted ? null : await runOnboardingAutopilot(ctx, { campaignId: campaign?.id ?? null });
  return { campaignId: campaign?.id ?? null, discoveryRunId: autopilot?.discovery.runId ?? null, autopilot };
}
