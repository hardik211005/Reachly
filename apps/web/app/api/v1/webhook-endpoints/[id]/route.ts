import { deleteEndpoint } from "@repo/core/workflows/endpoints";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "integrations:manage" }, async ({ ctx, params }) => {
  await deleteEndpoint(ctx, params.id);
  return noContent();
});
