import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@repo/core/errors";
import { rateLimit } from "@repo/core/rate-limit";
import { viewPublicQuote } from "@repo/core/quotes/service";

/**
 * Records that the prospect opened the quote. Called from the page in the browser, so email
 * link scanners (which fetch the page but don't run scripts) don't count as views.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await rateLimit(`quote-view:${token.slice(-24)}`, 20, 60);
  if (!limited.allowed) return new NextResponse(null, { status: 204 });
  try {
    await viewPublicQuote(token, { recordView: true });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
