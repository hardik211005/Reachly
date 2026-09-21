import { deleteSavedSearch } from "@repo/core/leads/saved";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "discovery:run" }, async ({ ctx, params }) => {
  await deleteSavedSearch(ctx, params.id);
  return noContent();
});
