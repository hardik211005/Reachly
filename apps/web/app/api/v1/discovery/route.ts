import { z } from "zod";
import { listDiscoveryRuns, startDiscovery } from "@repo/core/discovery/service";
import { discoveryRequestSchema } from "@repo/core/discovery/schemas";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }), permission: "leads:read" }, async ({ ctx, query }) =>
  ok(await listDiscoveryRuns(ctx, query.limit)),
);

export const POST = route({ body: discoveryRequestSchema, permission: "discovery:run", rateLimit: 10 }, async ({ ctx, body }) => created(await startDiscovery(ctx, body)));
