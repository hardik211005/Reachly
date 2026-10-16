import { z } from "zod";
import { listReviews, requestReview } from "@repo/core/grow/service";
import { ok, route } from "@/lib/api";

export const GET = route({ permission: "crm:read" }, async ({ ctx }) => ok(await listReviews(ctx)));

const body = z.object({ leadId: z.uuid().nullish(), dealId: z.uuid().nullish() });

/** A private review link for a customer (reused while it's unanswered), with a ready WhatsApp message. */
export const POST = route(
  { body, permission: "crm:write", rateLimit: 30 },
  async ({ ctx, body: input }) => ok(await requestReview(ctx, input)),
);
