import { z } from "zod";
import { bulkReview } from "@repo/core/outreach/approvals";
import { ok, route } from "@/lib/api";

const body = z.object({ ids: z.array(z.uuid()).min(1).max(200), action: z.enum(["approve", "reject"]) });

export const POST = route({ body, permission: "outreach:approve", rateLimit: 20 }, async ({ ctx, body: input }) => ok(await bulkReview(ctx, input)));
