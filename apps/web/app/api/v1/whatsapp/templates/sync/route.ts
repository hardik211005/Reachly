import { syncWhatsAppTemplates } from "@repo/core/outreach/whatsapp-templates";
import { ok, route } from "@/lib/api";

export const POST = route({ permission: "campaigns:write", rateLimit: 6 }, async ({ ctx }) => ok(await syncWhatsAppTemplates(ctx)));
