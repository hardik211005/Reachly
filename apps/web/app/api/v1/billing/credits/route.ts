import { z } from "zod";
import { startCreditPurchase } from "@repo/core/billing/payments";
import { ok, route } from "@/lib/api";

const body = z.object({ pack: z.string().min(1).max(40) });

/** Buy a credit pack (owner only). Returns a Razorpay order, or the credits straight away in development without keys. */
export const POST = route(
  { body, permission: "billing:manage", rateLimit: 10 },
  async ({ ctx, body: input }) => ok(await startCreditPurchase(ctx, input)),
);
