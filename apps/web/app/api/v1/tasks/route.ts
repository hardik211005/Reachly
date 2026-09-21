import { createTask, listTasks, taskInputSchema, taskListQuerySchema } from "@repo/core/crm/tasks";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: taskListQuerySchema, permission: "crm:read" }, async ({ ctx, query }) => ok(await listTasks(ctx, query)));

export const POST = route({ body: taskInputSchema, permission: "crm:write" }, async ({ ctx, body }) => created(await createTask(ctx, body)));
