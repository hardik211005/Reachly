import { getBusinessProfile, upsertBusinessProfile } from "@repo/core/business/service";
import { businessProfileInputSchema } from "@repo/core/business/schemas";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await getBusinessProfile(ctx)));

export const PUT = route({ body: businessProfileInputSchema, permission: "workspace:manage" }, async ({ ctx, body }) =>
  ok(await upsertBusinessProfile(ctx, body)),
);
