import { updateIcp } from "@repo/core/business/service";
import { icpSchema } from "@repo/core/business/schemas";
import { ok, route } from "@/lib/api";

export const PUT = route({ body: icpSchema, permission: "workspace:manage" }, async ({ ctx, body }) => {
  const profile = await updateIcp(ctx, body);
  return ok({ icp: profile.icp });
});
