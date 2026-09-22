import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@repo/core/errors";
import { rateLimit } from "@repo/core/rate-limit";
import { quoteResponseSchema, respondToQuote } from "@repo/core/quotes/service";

/** The prospect accepts or declines on the quote page. No session: the signed link is the credential. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await rateLimit(`quote-respond:${token.slice(-24)}`, 10, 60);
  if (!limited.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  const parsed = quoteResponseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Type your name to confirm" } }, { status: 400 });
  try {
    const view = await respondToQuote(token, parsed.data);
    return NextResponse.json({ data: { status: view.status, respondedByName: view.respondedByName } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
