import { getEnv } from "@repo/config/env";
import { resolvePlan } from "@repo/core/billing/plans";
import { getProviderStatuses } from "@repo/core/integrations/status";
import { listMemberships } from "@repo/core/organizations/service";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellData } from "@/components/shell/shell-context";
import { requireWorkspace } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, membership, ctx } = await requireWorkspace();
  const [plan, memberships, statuses] = await Promise.all([
    resolvePlan(ctx),
    listMemberships(session.user.id),
    getProviderStatuses(ctx),
  ]);

  const data: ShellData = {
    user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null },
    workspace: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      currency: membership.organization.currency,
      timezone: membership.organization.timezone,
    },
    workspaces: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, slug: m.organization.slug })),
    role: membership.role,
    plan: { key: plan.key, name: plan.name },
    demoMode: getEnv().DEMO_MODE,
    mockProviders: statuses.filter((status) => status.mode === "mock").map((status) => status.label),
  };

  return <AppShell data={data}>{children}</AppShell>;
}
