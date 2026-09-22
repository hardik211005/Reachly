import { z } from "zod";
import { acceptInvitation } from "@repo/core/organizations/members";
import { ok, userRoute } from "@/lib/api";

export const POST = userRoute({ body: z.object({ token: z.string().min(10).max(200) }), rateLimit: 10 }, async ({ userId, body }) => ok(await acceptInvitation(userId, body.token)));
