import { z } from "zod";
import { addNote } from "@repo/core/leads/service";
import { created, route } from "@/lib/api";

const body = z.object({ body: z.string().trim().min(1).max(10_000) });

export const POST = route<{ id: string }, typeof body>({ body, permission: "crm:write" }, async ({ ctx, params, body: input }) =>
  created(await addNote(ctx, { leadId: params.id, body: input.body })),
);
