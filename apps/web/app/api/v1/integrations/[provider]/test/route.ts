import { testIntegration } from "@repo/core/integrations/manage";
import { ok, route } from "@/lib/api";

export const POST = route<{ provider: string }>({ permission: "integrations:manage", rateLimit: 10 }, async ({ ctx, params }) => ok(await testIntegration(ctx, params.provider)));
