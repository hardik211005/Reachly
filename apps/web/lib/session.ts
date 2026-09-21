import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createTenantContext, type TenantContext } from "@repo/core/context";
import { resolveMembership } from "@repo/core/organizations/service";
import { auth } from "./auth";

/** Session for the current request (memoised per request via React cache). */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export const getWorkspace = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const membership = await resolveMembership(session.user.id);
  if (!membership) return { session, membership: null, ctx: null } as const;
  const ctx: TenantContext = createTenantContext({
    organizationId: membership.organizationId,
    userId: session.user.id,
    role: membership.role,
  });
  return { session, membership, ctx } as const;
});

/**
 * For pages inside /app: guarantees a signed-in user with a workspace that finished
 * onboarding, and returns the tenant context for server components.
 */
export async function requireWorkspace() {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/login");
  if (!workspace.membership || !workspace.ctx) redirect("/onboarding");
  if (!workspace.membership.organization.onboardingCompleted) redirect("/onboarding");
  return { session: workspace.session, membership: workspace.membership, ctx: workspace.ctx };
}
