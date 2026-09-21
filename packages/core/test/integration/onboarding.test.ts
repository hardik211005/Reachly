import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { createTenantContext } from "../../src/context";
import { recordEvent } from "../../src/events";
import { finishOnboarding, saveOnboardingBusiness } from "../../src/onboarding/service";
import { analyzeBusiness } from "../../src/business/service";
import { FeatureNotInPlanError } from "../../src/errors";
import { createUser, resetDatabase } from "./helpers";

const businessInput = {
  profile: {
    name: "CupCraft Packaging",
    industry: "Packaging manufacturing",
    description: "We manufacture custom-printed paper cups for cafes and restaurants, MOQ 5,000.",
    city: "New Delhi",
    businessSize: "MEDIUM" as const,
    targetCustomerTypes: ["Cafes", "Restaurants"],
  },
  offerings: [{ type: "PRODUCT" as const, name: "Custom branded paper cups", unitPrice: 3.5, minOrderQuantity: 5000 }],
};

describe("onboarding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates the workspace, owner membership, subscription, compliance and scoring defaults", async () => {
    const user = await createUser("Founder");
    const result = await saveOnboardingBusiness(user.id, businessInput);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
      include: { memberships: true, subscription: { include: { plan: true } }, complianceSettings: true, scoringProfile: true },
    });
    expect(org.name).toBe("CupCraft Packaging");
    expect(org.memberships[0]?.role).toBe("OWNER");
    expect(org.subscription?.plan.key).toBe("free");
    expect(org.complianceSettings).not.toBeNull();
    expect(org.scoringProfile).not.toBeNull();
  });

  it("derives an ICP grounded in the profile (mock provider) and records AI usage", async () => {
    const user = await createUser();
    const { organizationId } = await saveOnboardingBusiness(user.id, businessInput);
    const ctx = createTenantContext({ organizationId, userId: user.id, role: "OWNER" });
    const { icp } = await analyzeBusiness(ctx);
    expect(icp.targetCategories).toEqual(expect.arrayContaining(["cafe", "restaurant"]));
    expect(icp.idealCustomerProfile.mustHaves.join(" ")).toContain("5,000");
    const requests = await ctx.db.aIRequest.findMany();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.agent).toBe("business_understanding");
    const counter = await ctx.db.usageCounter.findFirst({ where: { metric: "AI_CREDITS" } });
    expect(counter?.used).toBeGreaterThan(0);
  });

  it("enforces plan automation modes when creating the first campaign", async () => {
    const user = await createUser();
    const { organizationId } = await saveOnboardingBusiness(user.id, businessInput);
    const ctx = createTenantContext({ organizationId, userId: user.id, role: "OWNER" });
    const campaign = {
      name: "Delhi Cafes",
      automationMode: "AUTOMATED" as const,
      target: { categories: ["cafe"] },
      channels: ["EMAIL" as const],
    };
    await expect(finishOnboarding(ctx, { campaign })).rejects.toBeInstanceOf(FeatureNotInPlanError);
    const ok = await finishOnboarding(ctx, { campaign: { ...campaign, automationMode: "MANUAL" } });
    expect(ok.campaignId).toBeTruthy();
    const steps = await prisma.campaignStep.count({ where: { campaignId: ok.campaignId as string } });
    expect(steps).toBeGreaterThanOrEqual(3);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.onboardingCompleted).toBe(true);
  });

  it("records events idempotently", async () => {
    const user = await createUser();
    const { organizationId } = await saveOnboardingBusiness(user.id, businessInput);
    const ctx = createTenantContext({ organizationId, userId: user.id, role: "OWNER" });
    const first = await recordEvent(ctx, { type: "lead_created", idempotencyKey: "abc" });
    const second = await recordEvent(ctx, { type: "lead_created", idempotencyKey: "abc" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await ctx.db.event.count({ where: { type: "lead_created" } })).toBe(1);
  });
});
