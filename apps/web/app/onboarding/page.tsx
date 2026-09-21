import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEFAULT_PLAN_KEY, getPlanDefinition } from "@repo/config";
import { resolvePlan } from "@repo/core/billing/plans";
import { readIcp } from "@repo/core/business/service";
import { OnboardingWizard, type OnboardingInitial } from "@/components/onboarding/onboarding-wizard";
import { getWorkspace, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await requireUser();
  const { new: newParam } = await searchParams;
  const workspace = await getWorkspace();
  const newWorkspace = newParam === "1" && Boolean(workspace?.membership);

  if (workspace?.membership?.organization.onboardingCompleted && !newWorkspace) redirect("/app");

  const ctx = workspace?.ctx ?? null;
  const [profile, offerings, plan] = ctx
    ? await Promise.all([
        ctx.db.businessProfile.findFirst(),
        ctx.db.offering.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } }),
        resolvePlan(ctx),
      ])
    : [null, [], null];

  // New workspaces start on the default plan.
  const defaultPlan = getPlanDefinition(DEFAULT_PLAN_KEY);
  const features = newWorkspace || !plan ? defaultPlan?.features : plan.features;

  const initial: OnboardingInitial = {
    userName: session.user.name,
    hasWorkspace: Boolean(ctx),
    newWorkspace,
    allowedModes: features?.automationModes ?? ["MANUAL"],
    allowedChannels: features?.channels ?? ["EMAIL"],
    planName: newWorkspace || !plan ? (defaultPlan?.name ?? "Free") : plan.name,
    currency: workspace?.membership?.organization.currency ?? "INR",
    timezone: workspace?.membership?.organization.timezone ?? "Asia/Kolkata",
    profile: profile
      ? {
          name: profile.name,
          website: profile.website ?? "",
          industry: profile.industry,
          description: profile.description,
          city: profile.city ?? "",
          region: profile.region ?? "",
          country: profile.country ?? "",
          businessSize: profile.businessSize,
          pricingModel: profile.pricingModel ?? "",
          targetIndustries: profile.targetIndustries,
          targetCustomerTypes: profile.targetCustomerTypes,
          outreachTone: profile.outreachTone,
        }
      : null,
    offerings: offerings.map((offering) => ({
      type: offering.type,
      name: offering.name,
      description: offering.description ?? "",
      unitPrice: offering.unitPrice ? offering.unitPrice.toString() : "",
      unit: offering.unit,
      minOrderQuantity: offering.minOrderQuantity ? String(offering.minOrderQuantity) : "",
    })),
    icp: profile ? readIcp(profile.icp) : null,
  };

  return <OnboardingWizard initial={initial} />;
}
