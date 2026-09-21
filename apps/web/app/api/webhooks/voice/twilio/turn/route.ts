import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@repo/config/env";
import { twilioConversationTurn } from "@repo/core/calls/webhooks";
import { AppError } from "@repo/core/errors";
import { logger } from "@repo/core/logger";

const HANGUP = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

/** One conversational turn of a Twilio AI call: returns TwiML (say + listen, or hang up). */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const url = `${getEnv().APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;
  try {
    const xml = await twilioConversationTurn({ headers: req.headers, rawBody, url });
    return new NextResponse(xml, { headers: { "content-type": "text/xml; charset=utf-8" } });
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return new NextResponse("Forbidden", { status: 403 });
    logger.error({ err: error }, "twilio conversation turn failed");
    return new NextResponse(HANGUP, { headers: { "content-type": "text/xml; charset=utf-8" } });
  }
}
