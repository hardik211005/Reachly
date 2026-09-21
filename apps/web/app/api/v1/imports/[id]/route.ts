import { getImport } from "@repo/core/leads/service";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "leads:read" }, async ({ ctx, params }) => ok(await getImport(ctx, params.id)));
