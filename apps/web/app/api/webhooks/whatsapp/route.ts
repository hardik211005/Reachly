import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";
import { ingestWhatsAppWebhook, verifyWhatsAppSubscription } from "@repo/core/outreach/webhooks";

/** Meta webhook subscription handshake. */
export function GET(req: NextRequest) {
  const challenge = verifyWhatsAppSubscription(req.nextUrl.searchParams);
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/** WhatsApp Cloud API messages and statuses. Signature-verified with the app secret. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  try {
    return NextResponse.json(await ingestWhatsAppWebhook({ headers: req.headers, rawBody, url: req.url }));
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    logger.error({ err: error }, "whatsapp webhook failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Webhook processing failed" } }, { status: 500 });
  }
}
