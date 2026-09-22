import type { Metadata } from "next";
import { AppError } from "@repo/core/errors";
import { viewPublicQuote } from "@repo/core/quotes/service";
import { Logo } from "@/components/brand/logo";
import { QuoteDocument, type QuoteDoc } from "@/components/quotes/quote-document";
import { PublicQuoteActions } from "./quote-actions";

export const metadata: Metadata = { title: "Quote", robots: { index: false, follow: false } };

function serialize<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The prospect's view of a sent quote: read it, download the PDF, accept or decline. */
export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: Awaited<ReturnType<typeof viewPublicQuote>>["view"] | null = null;
  try {
    view = (await viewPublicQuote(token)).view;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }

  if (!view) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold">This quote isn’t available</h1>
          <p className="mt-2 text-[13px] text-foreground-muted">The link is invalid or the quote was withdrawn. Reply to the email it came with and the sender will send a new one.</p>
        </div>
      </main>
    );
  }

  const doc = serialize<QuoteDoc>(view);
  return (
    <main className="min-h-dvh bg-surface-sunken px-4 py-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <PublicQuoteActions
          token={token}
          quote={{
            number: view.number,
            status: view.status,
            expired: view.expired,
            total: view.total,
            currency: view.currency,
            validUntil: doc.validUntil,
            respondedByName: view.respondedByName,
            respondedAt: doc.acceptedAt ?? doc.rejectedAt,
            sellerName: view.seller.name,
            leadName: view.lead.name,
            contactName: view.contact?.name ?? null,
            pdfUrl: view.publicPdfUrl,
          }}
        />
        <QuoteDocument quote={doc} />
        <div className="flex items-center justify-center gap-2 pb-4 text-xs text-foreground-subtle">
          Sent via <Logo className="scale-90 opacity-70" />
        </div>
      </div>
    </main>
  );
}
