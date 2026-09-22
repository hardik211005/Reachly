import { revokeInvitation } from "@repo/core/organizations/members";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "members:manage" }, async ({ ctx, params }) => {
  await revokeInvitation(ctx, params.id);
  return noContent();
});
