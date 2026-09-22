import { changeMemberRole, removeMember, roleSchema } from "@repo/core/organizations/members";
import { noContent, ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof roleSchema>({ body: roleSchema, permission: "members:manage", rateLimit: 30 }, async ({ ctx, params, body }) => ok(await changeMemberRole(ctx, params.id, body)));

/** Removes a member, or (for your own membership) leaves the workspace. */
export const DELETE = route<{ id: string }>({ permission: "workspace:read" }, async ({ ctx, params }) => {
  await removeMember(ctx, params.id);
  return noContent();
});
