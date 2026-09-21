import { createWhatsAppTemplate, listWhatsAppTemplates, templateInputSchema } from "@repo/core/outreach/whatsapp-templates";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "campaigns:read" }, async ({ ctx }) => {
  const result = await listWhatsAppTemplates(ctx);
  return ok(result.templates, { provider: result.provider });
});

export const POST = route({ body: templateInputSchema, permission: "campaigns:write" }, async ({ ctx, body }) => created(await createWhatsAppTemplate(ctx, body)));
