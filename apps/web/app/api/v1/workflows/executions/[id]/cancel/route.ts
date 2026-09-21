import { cancelExecution } from "@repo/core/workflows/service";
import { noContent, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "workflows:write" }, async ({ ctx, params }) => {
  await cancelExecution(ctx, params.id);
  return noContent();
});
