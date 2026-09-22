import { createDeal, dealInputSchema, listPipeline, pipelineQuerySchema } from "@repo/core/crm/deals";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: pipelineQuerySchema, permission: "crm:read" }, async ({ ctx, query }) => ok(await listPipeline(ctx, query)));

export const POST = route({ body: dealInputSchema, permission: "crm:write" }, async ({ ctx, body }) => created(await createDeal(ctx, body)));
