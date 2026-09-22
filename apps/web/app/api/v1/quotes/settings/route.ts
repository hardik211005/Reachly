import { getQuoteSettings, quoteSettingsSchema, updateQuoteSettings } from "@repo/core/quotes/settings";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "crm:read" }, async ({ ctx }) => ok(await getQuoteSettings(ctx)));

export const PATCH = route({ body: quoteSettingsSchema, permission: "workspace:manage" }, async ({ ctx, body }) => ok(await updateQuoteSettings(ctx, body)));
