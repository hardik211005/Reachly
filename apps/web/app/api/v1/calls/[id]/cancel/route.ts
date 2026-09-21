import { cancelCall } from "@repo/core/calls/service";
import { noContent, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "calls:place" }, async ({ ctx, params }) => {
  await cancelCall(ctx, params.id);
  return noContent();
});
