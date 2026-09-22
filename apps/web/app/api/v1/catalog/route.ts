import { getCatalog } from "@repo/core/quotes/catalog";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "crm:read" }, async ({ ctx }) => ok(await getCatalog(ctx)));
