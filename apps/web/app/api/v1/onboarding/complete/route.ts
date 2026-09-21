import { finishOnboarding, onboardingCompleteSchema } from "@repo/core/onboarding/service";
import { ok, route } from "@/lib/api";

export const POST = route({ body: onboardingCompleteSchema, permission: "workspace:manage" }, async ({ ctx, body }) => {
  return ok(await finishOnboarding(ctx, body));
});
