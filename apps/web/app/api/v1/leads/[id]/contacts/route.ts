import { addContact } from "@repo/core/leads/service";
import { contactInputSchema } from "@repo/core/leads/schemas";
import { created, route } from "@/lib/api";

export const POST = route<{ id: string }, typeof contactInputSchema>({ body: contactInputSchema, permission: "leads:write" }, async ({ ctx, params, body }) =>
  created(await addContact(ctx, params.id, body)),
);
