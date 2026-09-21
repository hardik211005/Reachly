import { deleteSavedView } from "@repo/core/leads/saved";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "leads:read" }, async ({ ctx, params }) => {
  await deleteSavedView(ctx, params.id);
  return noContent();
});
