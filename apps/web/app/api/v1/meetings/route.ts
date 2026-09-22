import { createMeeting, listMeetings, meetingInputSchema, meetingListSchema } from "@repo/core/crm/meetings";
import { created, ok, route } from "@/lib/api";

export const GET = route({ query: meetingListSchema, permission: "crm:read" }, async ({ ctx, query }) => ok(await listMeetings(ctx, query)));

export const POST = route({ body: meetingInputSchema, permission: "crm:write" }, async ({ ctx, body }) => created(await createMeeting(ctx, body)));
