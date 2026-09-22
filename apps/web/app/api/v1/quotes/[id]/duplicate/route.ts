import { duplicateQuote } from "@repo/core/quotes/service";
import { created, route } from "@/lib/api";

export const POST = route<{ id: string }>({ permission: "quotes:write" }, async ({ ctx, params }) => created(await duplicateQuote(ctx, params.id)));
