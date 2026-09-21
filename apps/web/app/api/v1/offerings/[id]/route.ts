import { deleteOffering, updateOffering } from "@repo/core/business/service";
import { offeringInputSchema } from "@repo/core/business/schemas";
import { noContent, ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof offeringInputSchema>(
  { body: offeringInputSchema, permission: "workspace:manage" },
  async ({ ctx, body, params }) => ok(await updateOffering(ctx, params.id, body)),
);

export const DELETE = route<{ id: string }>({ permission: "workspace:manage" }, async ({ ctx, params }) => {
  await deleteOffering(ctx, params.id);
  return noContent();
});
