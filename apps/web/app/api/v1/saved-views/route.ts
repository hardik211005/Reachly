import { z } from "zod";
import { createSavedView, listSavedViews, savedViewSchema } from "@repo/core/leads/saved";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: z.object({ resource: z.string().max(40).default("leads") }), permission: "leads:read" }, async ({ ctx, query }) =>
  ok(await listSavedViews(ctx, query.resource)),
);

export const POST = route({ body: savedViewSchema, permission: "leads:read" }, async ({ ctx, body }) => created(await createSavedView(ctx, body)));
