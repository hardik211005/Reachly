import { askCopilot, copilotRequestSchema } from "@repo/core/copilot/service";
import "@repo/core/copilot/tools";
import { ok, route } from "@/lib/api";

export const POST = route({ body: copilotRequestSchema, permission: "ai:use", rateLimit: 20 }, async ({ ctx, body }) =>
  ok(await askCopilot(ctx, body)),
);
