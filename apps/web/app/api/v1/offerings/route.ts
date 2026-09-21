import { createOffering, listOfferings } from "@repo/core/business/service";
import { offeringInputSchema } from "@repo/core/business/schemas";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "workspace:read" }, async ({ ctx }) => ok(await listOfferings(ctx)));

export const POST = route({ body: offeringInputSchema, permission: "workspace:manage" }, async ({ ctx, body }) =>
  created(await createOffering(ctx, body)),
);
