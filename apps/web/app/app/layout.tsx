import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { resolvePlan, trialStatus } from "@repo/core/billing/plans";
import { getProviderStatuses } from "@repo/core/integrations/status";
import { listMemberships } from "@repo/core/organizations/service";
import { getUsage } from "@repo/core/billing/usage";
import { isPlatformAdmin } from "@repo/core/platform/admin";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellData } from "@/components/shell/shell-context";
import { requireWorkspace } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, membership, ctx } = await requireWorkspace();
  // Name and photo come from the database: the session cookie caches them for a few minutes,
  // so a new profile photo or name would otherwise lag behind.
  const [plan, memberships, statuses, usage, profile] = await Promise.all([
    resolvePlan(ctx),
    listMemberships(session.user.id),
    getProviderStatuses(ctx),
    getUsage(ctx),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, image: true } }),
  ]);
  const trial = trialStatus(plan.subscription);
  const leadUsage = usage.metrics.find((metric) => metric.metric === "LEAD_CREDITS");

  const data: ShellData = {
    user: {
      id: session.user.id,
      name: profile?.name ?? session.user.name,
      email: session.user.email,
      image: profile?.image ?? null,
    },
    workspace: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      currency: membership.organization.currency,
      timezone: membership.organization.timezone,
      logoUrl: membership.organization.logoUrl,
    },
    workspaces: memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
    })),
    role: membership.role,
    plan: { key: plan.key, name: plan.name },
    demoMode: getEnv().DEMO_MODE,
    mockProviders: statuses
      .filter((status) => status.mode === "mock")
      .map((status) => status.label),
    platformAdmin: isPlatformAdmin(session.user.email, session.user.emailVerified),
    trial: trial ? { planName: plan.name, daysLeft: trial.daysLeft } : null,
    leadsLeft: leadUsage?.remaining ?? null,
    leadsTotal: leadUsage?.limit == null ? null : leadUsage.limit + leadUsage.extra,
  };

  return <AppShell data={data}>{children}</AppShell>;
}
