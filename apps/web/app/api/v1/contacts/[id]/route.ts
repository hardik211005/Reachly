import { deleteContact, updateContact } from "@repo/core/leads/service";
import { contactInputSchema } from "@repo/core/leads/schemas";
import { noContent, ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof contactInputSchema>({ body: contactInputSchema, permission: "leads:write" }, async ({ ctx, params, body }) =>
  ok(await updateContact(ctx, params.id, body)),
);

export const DELETE = route<{ id: string }>({ permission: "leads:write" }, async ({ ctx, params }) => {
  await deleteContact(ctx, params.id);
  return noContent();
});
