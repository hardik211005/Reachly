import { z } from "zod";
import { globalSearch } from "@repo/core/search/service";
import { ok, route } from "@/lib/api";

export const GET = route({ query: z.object({ q: z.string().max(120).default("") }), permission: "leads:read" }, async ({ ctx, query }) =>
  ok(await globalSearch(ctx, query.q)),
);
