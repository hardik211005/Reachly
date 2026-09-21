import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";
import { ingestEmailWebhook } from "@repo/core/outreach/webhooks";

/** Email provider events (delivery, opens, bounces, inbound replies). Signature-verified. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await req.text();
  try {
    const result = await ingestEmailWebhook(provider, { headers: req.headers, rawBody, url: req.url }, { integrationId: req.nextUrl.searchParams.get("integration") });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    logger.error({ err: error, provider }, "email webhook failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Webhook processing failed" } }, { status: 500 });
  }
}
