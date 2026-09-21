import { z } from "zod";
import { deleteWhatsAppTemplate, updateTemplateVariables } from "@repo/core/outreach/whatsapp-templates";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };
const body = z.object({ variables: z.array(z.string().trim().min(1).max(40)).max(10) });

export const PATCH = route<Params, typeof body>({ body, permission: "campaigns:write" }, async ({ ctx, params, body: input }) =>
  ok(await updateTemplateVariables(ctx, params.id, input.variables)),
);

export const DELETE = route<Params>({ permission: "campaigns:write" }, async ({ ctx, params }) => {
  await deleteWhatsAppTemplate(ctx, params.id);
  return noContent();
});
