import { deleteAccount, deleteAccountSchema } from "@repo/core/organizations/lifecycle";
import { listMemberships } from "@repo/core/organizations/service";
import { permissionsFor } from "@repo/core/rbac";
import { ApiResponse, ok, userRoute } from "@/lib/api";
import { auth } from "@/lib/auth";

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

/**
 * Deletes the signed-in account (and workspaces where it is the only member), then signs out.
 * Sessions are cached in a signed cookie for a few minutes, so the cookies must be cleared here —
 * otherwise the browser would still look signed in as a user that no longer exists.
 */
export const DELETE = userRoute({ body: deleteAccountSchema, rateLimit: 5 }, async ({ req, userId, body }) => {
  const result = await deleteAccount(userId, body);
  const signOut = await auth.api.signOut({ headers: req.headers, asResponse: true });
  return new ApiResponse({ data: result }, 200, {}, signOut.headers.getSetCookie());
});
