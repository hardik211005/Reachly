import { logManualCall, manualOutcomeSchema } from "@repo/core/calls/service";
import { ok, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof manualOutcomeSchema>({ body: manualOutcomeSchema, permission: "calls:place" }, async ({ ctx, params, body }) =>
  ok(await logManualCall(ctx, params.id, body)),
);
