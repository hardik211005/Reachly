import { createEndpoint, endpointInputSchema, listEndpoints, subscribableEvents } from "@repo/core/workflows/endpoints";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "integrations:manage" }, async ({ ctx }) => ok(await listEndpoints(ctx), { events: subscribableEvents() }));

export const POST = route({ body: endpointInputSchema, permission: "integrations:manage", rateLimit: 10 }, async ({ ctx, body }) => created(await createEndpoint(ctx, body)));
