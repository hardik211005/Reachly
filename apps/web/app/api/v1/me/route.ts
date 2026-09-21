import { listMemberships } from "@repo/core/organizations/service";
import { permissionsFor } from "@repo/core/rbac";
import { ok, userRoute } from "@/lib/api";

export const GET = userRoute({}, async ({ userId, ctx }) => {
  const memberships = await listMemberships(userId);
  return ok({
    userId,
    workspaceId: ctx?.organizationId ?? null,
    role: ctx?.role ?? null,
    permissions: ctx ? permissionsFor(ctx.role) : [],
    workspaces: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role })),
  });
});
