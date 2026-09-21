import { createImport } from "@repo/core/leads/service";
import { importRequestSchema } from "@repo/core/leads/schemas";
import { created, route } from "@/lib/api";

export const POST = route({ body: importRequestSchema, permission: "leads:write", rateLimit: 5 }, async ({ ctx, body }) => created(await createImport(ctx, body)));
