import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotFoundError } from "@repo/core/errors";
import { getCatalog } from "@repo/core/quotes/catalog";
import { getQuote } from "@repo/core/quotes/service";
import { PageContainer } from "@/components/page";
import { QuoteEditor, type EditorCatalog, type QuoteView } from "@/components/quotes/quote-editor";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Quote" };

/** Serialises Dates/Decimals into the JSON shape the client components use. */
function serialize<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspace();
  const { id } = await params;
  let quote;
  try {
    quote = await getQuote(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [catalog, contacts] = await Promise.all([
    getCatalog(ctx),
    ctx.db.contact.findMany({ where: { leadId: quote.lead.id, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, email: true, title: true } }),
  ]);
  return (
    <PageContainer wide>
      <QuoteEditor initial={serialize<QuoteView>(quote)} catalog={serialize<EditorCatalog>(catalog)} contacts={contacts} />
    </PageContainer>
  );
}
