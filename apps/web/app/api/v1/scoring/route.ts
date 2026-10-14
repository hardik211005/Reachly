import { getScoringSettings, scoringSettingsSchema, updateScoringSettings } from "@repo/core/leads/scoring-settings";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getScoringSettings(ctx)));

export const PUT = route({ body: scoringSettingsSchema, permission: "workspace:manage", rateLimit: 20 }, async ({ ctx, body }) => ok(await updateScoringSettings(ctx, body)));
