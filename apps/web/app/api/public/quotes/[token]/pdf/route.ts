import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@repo/core/errors";
import { rateLimit } from "@repo/core/rate-limit";
import { renderQuotePdf } from "@repo/core/quotes/pdf";
import { viewPublicQuote } from "@repo/core/quotes/service";

/** The prospect's PDF download. No session: the signed link is the credential. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await rateLimit(`quote-pdf:${token.slice(-24)}`, 30, 60);
  if (!limited.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  try {
    const { view } = await viewPublicQuote(token);
    const pdf = await renderQuotePdf(view);
    return new NextResponse(new Blob([new Uint8Array(pdf)]), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${view.number}.pdf"`, "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
