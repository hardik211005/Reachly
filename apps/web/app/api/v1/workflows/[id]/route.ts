import { workflowInputSchema } from "@repo/core/workflows/schemas";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@repo/core/workflows/service";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const GET = route<Params>({ permission: "workflows:read" }, async ({ ctx, params }) => ok(await getWorkflow(ctx, params.id)));

export const PUT = route<Params, typeof workflowInputSchema>({ body: workflowInputSchema, permission: "workflows:write" }, async ({ ctx, params, body }) =>
  ok(await updateWorkflow(ctx, params.id, body)),
);

export const DELETE = route<Params>({ permission: "workflows:write" }, async ({ ctx, params }) => {
  await deleteWorkflow(ctx, params.id);
  return noContent();
});
