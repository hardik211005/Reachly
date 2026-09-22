import { quoteMessages } from "@repo/core/quotes/service";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "crm:read" }, async ({ ctx, params }) => ok(await quoteMessages(ctx, params.id)));
