import { meetingUpdateSchema, updateMeeting } from "@repo/core/crm/meetings";
import { ok, route } from "@/lib/api";

export const PATCH = route<{ id: string }, typeof meetingUpdateSchema>({ body: meetingUpdateSchema, permission: "crm:write" }, async ({ ctx, params, body }) =>
  ok(await updateMeeting(ctx, params.id, body)),
);
