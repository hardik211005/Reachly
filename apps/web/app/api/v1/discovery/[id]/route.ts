import { getDiscoveryRun } from "@repo/core/discovery/service";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "leads:read", rateLimit: 240 }, async ({ ctx, params }) => ok(await getDiscoveryRun(ctx, params.id)));
