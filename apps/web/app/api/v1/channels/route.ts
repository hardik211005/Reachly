import { channelAvailability } from "@repo/core/outreach/providers";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "campaigns:read" }, async ({ ctx }) => ok(await channelAvailability(ctx)));
