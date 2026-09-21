import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@repo/core/rate-limit";
import { startFromHook } from "@repo/core/workflows/service";

const MAX_BODY = 64 * 1024;

/** Inbound trigger for webhook-triggered workflows (n8n, Zapier, your backend). The signed token is the credential. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await rateLimit(`hook:${token.slice(-24)}`, 120, 60);
  if (!limited.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Body over 64 KB" } }, { status: 413 });
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Body must be a JSON object" } }, { status: 400 });
  }
  const result = await startFromHook(token, payload);
  if (!result.accepted) return NextResponse.json({ error: { code: "NOT_ACCEPTED", message: result.reason } }, { status: result.reason === "invalid token" ? 401 : 409 });
  return NextResponse.json(result, { status: 202 });
}
