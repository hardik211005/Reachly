import { z } from "zod";
import { applySuggestedWeights, clearLearnedModel, getScoringSettings, trainLearnedModel } from "@repo/core/leads/scoring-settings";
import { ok, route } from "@/lib/api";

const body = z.object({ action: z.enum(["train", "apply_weights"]) });

/** Train the learned conversion model now, or apply its suggested weights. */
export const POST = route({ body, permission: "leads:write", rateLimit: 10 }, async ({ ctx, body: input }) => {
  if (input.action === "apply_weights") return ok(await applySuggestedWeights(ctx));
  const result = await trainLearnedModel(ctx);
  return ok({ result: result.status === "trained" ? { status: result.status, metrics: result.model.metrics } : result, settings: await getScoringSettings(ctx) });
});

export const DELETE = route({ permission: "workspace:manage", rateLimit: 10 }, async ({ ctx }) => ok(await clearLearnedModel(ctx)));
