import { n8nStatus } from "@repo/core/workflows/n8n";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "workflows:read", rateLimit: 30 }, async ({ ctx }) => ok(await n8nStatus(ctx)));
