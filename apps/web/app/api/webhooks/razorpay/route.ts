import { NextResponse, type NextRequest } from "next/server";
import { ingestRazorpayWebhook } from "@repo/core/billing/payments";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";

/** Razorpay events (payment.captured, payment.failed). Signature-verified with RAZORPAY_WEBHOOK_SECRET. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  try {
    const result = await ingestRazorpayWebhook({ rawBody, signature: req.headers.get("x-razorpay-signature"), eventId: req.headers.get("x-razorpay-event-id") });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    logger.error({ err: error }, "razorpay webhook failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Webhook processing failed" } }, { status: 500 });
  }
}
