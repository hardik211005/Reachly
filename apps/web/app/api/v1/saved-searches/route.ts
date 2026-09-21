import { createSavedSearch, listSavedSearches, savedSearchSchema } from "@repo/core/leads/saved";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "leads:read" }, async ({ ctx }) => ok(await listSavedSearches(ctx)));

export const POST = route({ body: savedSearchSchema, permission: "discovery:run" }, async ({ ctx, body }) => created(await createSavedSearch(ctx, body)));
