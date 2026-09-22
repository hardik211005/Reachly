import { connectIntegration, connectIntegrationSchema, disconnectIntegration } from "@repo/core/integrations/manage";
import { ok, route } from "@/lib/api";

/** Connect or update. Secret values are encrypted and never returned. */
export const PUT = route<{ provider: string }, typeof connectIntegrationSchema>({ body: connectIntegrationSchema, permission: "integrations:manage", rateLimit: 20 }, async ({ ctx, params, body }) => ok(await connectIntegration(ctx, params.provider, body)));

export const DELETE = route<{ provider: string }>({ permission: "integrations:manage" }, async ({ ctx, params }) => ok(await disconnectIntegration(ctx, params.provider)));
