import { getSystemHealth } from "@repo/core/system/health";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "system:read", rateLimit: 30 }, async ({ ctx }) => ok(await getSystemHealth(ctx)));
