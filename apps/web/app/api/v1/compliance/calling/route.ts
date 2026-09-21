import { callingSettingsSchema, updateCallingSettings } from "@repo/core/compliance/settings";
import { ok, route } from "@/lib/api";

export const PUT = route({ body: callingSettingsSchema, permission: "compliance:manage", rateLimit: 20 }, async ({ ctx, body }) => {
  const settings = await updateCallingSettings(ctx, body);
  return ok({ callingEnabled: settings.callingEnabled, callingConsentAttested: settings.callingConsentAttested, recordCalls: settings.recordCalls, announceAiOnCalls: settings.announceAiOnCalls, dndCheckEnabled: settings.dndCheckEnabled });
});
