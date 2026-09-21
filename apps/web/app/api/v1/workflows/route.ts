import { z } from "zod";
import { workflowInputSchema } from "@repo/core/workflows/schemas";
import { createWorkflow, listWorkflows } from "@repo/core/workflows/service";
import { created, ok, route } from "@/lib/api";

export const GET = route({ permission: "workflows:read" }, async ({ ctx }) => ok(await listWorkflows(ctx)));

const body = z.union([z.object({ template: z.string().min(1).max(80) }), workflowInputSchema]);

export const POST = route({ body, permission: "workflows:write" }, async ({ ctx, body: input }) => created(await createWorkflow(ctx, input)));
