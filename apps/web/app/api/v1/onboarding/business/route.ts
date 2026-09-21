import { onboardingBusinessSchema, saveOnboardingBusiness } from "@repo/core/onboarding/service";
import { ok, userRoute } from "@/lib/api";

export const POST = userRoute({ body: onboardingBusinessSchema }, async ({ userId, body }) => {
  const result = await saveOnboardingBusiness(userId, body);
  return ok({ organizationId: result.organizationId, profileId: result.profile.id, offerings: result.offerings.length });
});
