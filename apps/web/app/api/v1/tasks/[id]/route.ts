import { deleteTask, taskUpdateSchema, updateTask } from "@repo/core/crm/tasks";
import { noContent, ok, route } from "@/lib/api";

type Params = { id: string };

export const PATCH = route<Params, typeof taskUpdateSchema>({ body: taskUpdateSchema, permission: "crm:write" }, async ({ ctx, params, body }) => ok(await updateTask(ctx, params.id, body)));

export const DELETE = route<Params>({ permission: "crm:write" }, async ({ ctx, params }) => {
  await deleteTask(ctx, params.id);
  return noContent();
});
