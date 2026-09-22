import { revokeApiKey } from "@repo/core/api-keys";
import { noContent, route } from "@/lib/api";

export const DELETE = route<{ id: string }>({ permission: "apikeys:manage" }, async ({ ctx, params }) => {
  await revokeApiKey(ctx, params.id);
  return noContent();
});
