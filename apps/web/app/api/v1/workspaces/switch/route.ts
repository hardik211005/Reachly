import { z } from "zod";
import { switchOrganization } from "@repo/core/organizations/service";
import { ok, userRoute } from "@/lib/api";

export const POST = userRoute({ body: z.object({ organizationId: z.uuid() }) }, async ({ userId, body }) => {
  const membership = await switchOrganization(userId, body.organizationId);
  return ok({ organizationId: membership.organizationId, role: membership.role });
});
