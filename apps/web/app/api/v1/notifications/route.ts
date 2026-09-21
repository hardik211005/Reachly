import { listNotifications } from "@repo/core/notifications";
import { ok, route } from "@/lib/api";

export const GET = route({}, async ({ ctx }) => ok(await listNotifications(ctx)));
