import { previewInputSchema, previewStepMessage } from "@repo/core/outreach/preview";
import { ok, route } from "@/lib/api";

export const POST = route({ body: previewInputSchema, permission: "campaigns:read", rateLimit: 30 }, async ({ ctx, body }) => ok(await previewStepMessage(ctx, body)));
