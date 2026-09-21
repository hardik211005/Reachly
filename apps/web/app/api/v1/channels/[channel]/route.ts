import { z } from "zod";
import { channelOverview } from "@repo/core/outreach/channel-overview";
import { NotFoundError } from "@repo/core/errors";
import { ok, route } from "@/lib/api";

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = route<{ channel: string }, undefined, typeof query>({ query, permission: "campaigns:read" }, async ({ ctx, params, query: input }) => {
  const channel = params.channel.toUpperCase();
  if (channel !== "EMAIL" && channel !== "WHATSAPP") throw new NotFoundError("Channel", params.channel);
  return ok(await channelOverview(ctx, channel, input.days));
});
