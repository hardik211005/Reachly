import { retryExecution } from "@repo/core/workflows/service";
import { noContent, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "workflows:write" }, async ({ ctx, params }) => {
  await retryExecution(ctx, params.id);
  return noContent();
});
