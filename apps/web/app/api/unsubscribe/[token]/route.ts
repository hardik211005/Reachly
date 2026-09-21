import { NextResponse, type NextRequest } from "next/server";
import { processUnsubscribe } from "@repo/core/outreach/unsubscribe";

/** RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). No session or CSRF: the signed token is the credential. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await processUnsubscribe(token);
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 400 });
}
