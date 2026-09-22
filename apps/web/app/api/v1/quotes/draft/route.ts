import { z } from "zod";
import { generateQuoteDraft } from "@repo/core/quotes/service";
import { created, route } from "@/lib/api";

const body = z.object({ leadId: z.uuid(), dealId: z.uuid().nullish() });

/** AI draft: items and quantities from the conversation, prices from the catalog. Never sent automatically. */
export const POST = route({ body, permission: "quotes:write", rateLimit: 20 }, async ({ ctx, body: input }) => created(await generateQuoteDraft(ctx, input)));
