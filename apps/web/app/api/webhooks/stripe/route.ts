import { NextResponse, type NextRequest } from "next/server";
import { ingestStripeWebhook } from "@repo/core/billing/payments";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";

/** Stripe events (subscriptions, invoices). Signature-verified with STRIPE_WEBHOOK_SECRET. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  try {
    return NextResponse.json(await ingestStripeWebhook({ rawBody, signature: req.headers.get("stripe-signature") }));
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    logger.error({ err: error }, "stripe webhook failed");
    // A 5xx makes Stripe retry later.
    return NextResponse.json({ error: { code: "INTERNAL", message: "Webhook processing failed" } }, { status: 500 });
  }
}
