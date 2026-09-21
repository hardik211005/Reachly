import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { analyzeBusiness, replaceOfferings, upsertBusinessProfile } from "../business/service";
import { syncPlans } from "../billing/plans";
import { createTenantContext, type TenantContext } from "../context";
import { createOrganization } from "../organizations/service";

export const DEMO_USER = { name: "Aarav Mehta", email: "demo@reachai.dev", password: "demo-password-2026" } as const;
export const DEMO_ORG_NAME = "Demo Growth Agency";

/**
 * Creates (or recreates) the demo user and workspace. The password hash comes from Better
 * Auth's own hasher so the account signs in through the normal auth flow.
 */
export async function seedDemoWorkspace(hashPassword: (password: string) => Promise<string>): Promise<{ ctx: TenantContext; userId: string }> {
  await syncPlans(prisma);

  let user = await prisma.user.findUnique({ where: { email: DEMO_USER.email } });
  if (!user) {
    user = await prisma.user.create({
      data: { id: randomUUID(), name: DEMO_USER.name, email: DEMO_USER.email, emailVerified: true },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: await hashPassword(DEMO_USER.password),
      },
    });
  }

  // Recreate the workspace from scratch so the seed is repeatable.
  const existing = await prisma.organization.findMany({
    where: { name: DEMO_ORG_NAME, memberships: { some: { userId: user.id } } },
    select: { id: true },
  });
  if (existing.length) await prisma.organization.deleteMany({ where: { id: { in: existing.map((org) => org.id) } } });

  const org = await createOrganization({ userId: user.id, name: DEMO_ORG_NAME, currency: "INR", timezone: "Asia/Kolkata", country: "India" });
  const pro = await prisma.plan.findUniqueOrThrow({ where: { key: "pro" } });
  await prisma.subscription.update({
    where: { organizationId: org.id },
    data: { planId: pro.id, currentPeriodStart: new Date(Date.now() - 12 * 86_400_000), currentPeriodEnd: new Date(Date.now() + 18 * 86_400_000) },
  });

  const ctx = createTenantContext({ organizationId: org.id, userId: user.id, role: "OWNER" });

  await upsertBusinessProfile(ctx, {
    name: DEMO_ORG_NAME,
    website: "https://demogrowth.example",
    industry: "Digital marketing agency",
    description:
      "Full-service growth agency for local businesses. We run social media, build conversion-focused websites, handle local SEO and paid ads for cafés, restaurants, D2C brands and startups across Delhi NCR.",
    city: "New Delhi",
    region: "Delhi",
    country: "India",
    businessSize: "SMALL",
    pricingModel: "Monthly retainers plus one-time website projects",
    targetIndustries: ["Food & Beverage", "Consumer Brands", "Technology"],
    targetCustomerTypes: ["Cafés", "Restaurants", "D2C brands", "Startups"],
    valueProposition: "More customers from social and search, with reporting you can actually read.",
    outreachTone: "friendly",
    preferredChannels: ["EMAIL", "WHATSAPP", "MANUAL_CALL"],
  });

  await replaceOfferings(ctx, [
    { type: "SERVICE", name: "Social media management", description: "Content calendar, 12 posts + 8 reels a month, community management.", unit: "month", unitPrice: 35000, currency: "INR", taxRatePercent: 18 },
    { type: "SERVICE", name: "Website development", description: "Conversion-focused website with online ordering or booking.", unit: "project", unitPrice: 85000, setupFee: 10000, currency: "INR", taxRatePercent: 18 },
    { type: "SERVICE", name: "Local SEO", description: "Google Business Profile, reviews programme and local landing pages.", unit: "month", unitPrice: 20000, currency: "INR", taxRatePercent: 18 },
    { type: "SERVICE", name: "Branding", description: "Logo, visual identity and packaging guidelines.", unit: "project", unitPrice: 60000, currency: "INR", taxRatePercent: 18 },
    { type: "SERVICE", name: "Paid ads management", description: "Meta and Google ads, managed for a percentage of spend (min. fee).", unit: "month", unitPrice: 25000, currency: "INR", taxRatePercent: 18 },
    { type: "PACKAGE", name: "Growth starter bundle", description: "Social media + Local SEO for 3 months.", unit: "month", unitPrice: 49000, minOrderQuantity: 3, currency: "INR", taxRatePercent: 18 },
  ]);

  await analyzeBusiness(ctx);
  await prisma.organization.update({ where: { id: org.id }, data: { onboardingCompleted: true } });

  // Pricing rules so the quote builder has something to apply.
  const bundle = await ctx.db.offering.findFirst({ where: { name: "Growth starter bundle" } });
  await ctx.db.pricingRule.createMany({
    data: [
      { organizationId: org.id, offeringId: bundle?.id ?? null, name: "6+ months commitment", type: "VOLUME_DISCOUNT_PERCENT", minQuantity: 6, value: 10, priority: 10 },
      { organizationId: org.id, offeringId: null, name: "Launch offer", type: "PERCENT_DISCOUNT", value: 5, priority: 1, isActive: false },
    ],
  });

  return { ctx, userId: user.id };
}
