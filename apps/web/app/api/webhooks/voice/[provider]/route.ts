import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@repo/config/env";
import { ingestVoiceWebhook } from "@repo/core/calls/webhooks";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";

/** Voice provider status and transcript callbacks (Vapi, Twilio). Verified per workspace. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await req.text();
  // Signatures are computed over the public URL the provider called.
  const url = `${getEnv().APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;
  try {
    return NextResponse.json(await ingestVoiceWebhook(provider, { headers: req.headers, rawBody, url }));
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    logger.error({ err: error, provider }, "voice webhook failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Webhook processing failed" } }, { status: 500 });
  }
}
