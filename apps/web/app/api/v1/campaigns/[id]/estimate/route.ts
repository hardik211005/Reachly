import { estimateLaunch } from "@repo/core/campaigns/lifecycle";
import { ok, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "campaigns:read" }, async ({ ctx, params }) => ok(await estimateLaunch(ctx, params.id)));
