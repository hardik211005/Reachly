import { z } from "zod";
import { markNotificationsRead } from "@repo/core/notifications";
import { noContent, route } from "@/lib/api";

export const POST = route({ body: z.object({ ids: z.array(z.uuid()).max(200).optional() }) }, async ({ ctx, body }) => {
  await markNotificationsRead(ctx, body.ids);
  return noContent();
});
