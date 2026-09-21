import { taskUpdateSchema, updateTask } from "@repo/core/crm/tasks";
import { ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof taskUpdateSchema>({ body: taskUpdateSchema, permission: "crm:write" }, async ({ ctx, params, body }) =>
  ok(await updateTask(ctx, params.id, body)),
);
