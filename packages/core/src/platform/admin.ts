import { PLAN_DEFINITIONS } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { ForbiddenError } from "../errors";

/**
 * Platform administration: one view across every workspace, for whoever runs this deployment.
 * Access comes only from PLATFORM_ADMIN_EMAILS, never from data a workspace can change.
 * Reads go straight through the base client because they intentionally span tenants.
 */

export function platformAdminEmails(): string[] {
  return (getEnv().PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string | null | undefined, emailVerified = true): boolean {
  if (!email) return false;
  // An unverified address could have been registered by someone else, so it never counts —
  // unless the deployment doesn't require verification at all.
  if (!emailVerified && getEnv().AUTH_REQUIRE_EMAIL_VERIFICATION) return false;
  return platformAdminEmails().includes(email.trim().toLowerCase());
}

export function assertPlatformAdmin(user: { email: string; emailVerified?: boolean | null }) {
  if (!isPlatformAdmin(user.email, user.emailVerified ?? false)) throw new ForbiddenError("Platform admins only");
}

const DAY = 86_400_000;

export async function getPlatformOverview(now: Date = new Date()) {
  const week = new Date(now.getTime() - 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);

  const [users, newUsersWeek, newUsersMonth, workspaces, deletedWorkspaces, leads, eventsWeek, subscriptions, organizations, lastEvents, leadCounts, userRows] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.user.count({ where: { createdAt: { gte: month } } }),
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.organization.count({ where: { deletedAt: { not: null } } }),
    prisma.lead.count({ where: { deletedAt: null, organization: { deletedAt: null } } }),
    prisma.event.count({ where: { occurredAt: { gte: week } } }),
    prisma.subscription.findMany({ where: { organization: { deletedAt: null } }, select: { status: true, billingProvider: true, plan: { select: { key: true, name: true, priceMonthly: true, currency: true } } } }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        deletedAt: true,
        onboardingCompleted: true,
        subscription: { select: { status: true, billingProvider: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, plan: { select: { key: true, name: true } } } },
        memberships: { select: { role: true, user: { select: { email: true, name: true } } }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.event.groupBy({ by: ["organizationId"], _max: { occurredAt: true } }),
    prisma.lead.groupBy({ by: ["organizationId"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        memberships: { select: { role: true, organization: { select: { name: true, deletedAt: true } } } },
        sessions: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const isPaying = (subscription: (typeof subscriptions)[number]) => subscription.billingProvider !== "none" && (subscription.status === "ACTIVE" || subscription.status === "TRIALING");
  const plans = new Map<string, { name: string; workspaces: number; paying: number }>();
  // Monthly revenue in minor units per currency: Stripe charges the plan's list price, UPI the INR price.
  const revenue: Record<string, number> = {};
  for (const subscription of subscriptions) {
    const entry = plans.get(subscription.plan.key) ?? { name: subscription.plan.name, workspaces: 0, paying: 0 };
    entry.workspaces += 1;
    if (isPaying(subscription)) {
      entry.paying += 1;
      const inr = PLAN_DEFINITIONS.find((plan) => plan.key === subscription.plan.key)?.priceMonthlyInr;
      const [currency, amount] = subscription.billingProvider === "razorpay" && inr ? ["INR", inr] : [subscription.plan.currency, subscription.plan.priceMonthly];
      revenue[currency] = (revenue[currency] ?? 0) + amount;
    }
    plans.set(subscription.plan.key, entry);
  }
  const lastActivity = new Map(lastEvents.map((row) => [row.organizationId, row._max.occurredAt]));
  const leadsByOrg = new Map(leadCounts.map((row) => [row.organizationId, row._count._all]));

  return {
    /** When this snapshot was taken; relative times ("3 days ago") are computed from it. */
    generatedAt: now.toISOString(),
    totals: {
      users,
      newUsersWeek,
      newUsersMonth,
      workspaces,
      deletedWorkspaces,
      leads,
      eventsWeek,
      payingWorkspaces: subscriptions.filter(isPaying).length,
      revenue,
    },
    plans: [...plans.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.workspaces - a.workspaces),
    workspaces: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      deletedAt: organization.deletedAt,
      onboardingCompleted: organization.onboardingCompleted,
      owner: organization.memberships.find((membership) => membership.role === "OWNER")?.user.email ?? null,
      members: organization.memberships.length,
      plan: organization.subscription?.plan.name ?? "—",
      billing: organization.subscription ? { provider: organization.subscription.billingProvider, status: organization.subscription.status, cancelAtPeriodEnd: organization.subscription.cancelAtPeriodEnd, currentPeriodEnd: organization.subscription.currentPeriodEnd } : null,
      leads: leadsByOrg.get(organization.id) ?? 0,
      lastActivityAt: lastActivity.get(organization.id) ?? null,
    })),
    users: userRows.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastSeenAt: user.sessions[0]?.updatedAt ?? null,
      workspaces: user.memberships.filter((membership) => !membership.organization.deletedAt).map((membership) => ({ name: membership.organization.name, role: membership.role })),
      platformAdmin: isPlatformAdmin(user.email, user.emailVerified),
    })),
  };
}
