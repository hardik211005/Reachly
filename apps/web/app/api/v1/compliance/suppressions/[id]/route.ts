import { removeSuppression } from "@repo/core/compliance/suppression";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "compliance:manage" }, async ({ ctx, params }) => {
  await removeSuppression(ctx, params.id);
  return noContent();
});
