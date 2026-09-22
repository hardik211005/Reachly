import { formatMoney } from "@repo/core/quotes/pricing";

/** The quote as a document — the same content and order as the PDF. Used by the editor preview and the public quote page. */

export interface QuoteDocLine {
  id?: string;
  description: string;
  details: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  setupFee: number;
  discount: number;
  taxRatePercent: number;
  lineTotal: number;
  appliedRules: Array<{ name: string; amount: number; detail: string }>;
}

export interface QuoteDoc {
  number: string;
  title: string | null;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  taxLabel: string;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  respondedByName: string | null;
  notes: string | null;
  terms: string | null;
  lead: { name: string; city: string | null; address: string | null; email: string | null };
  contact: { name: string | null; title: string | null; email: string | null } | null;
  seller: { name: string; legalName: string | null; address: string | null; taxId: string | null; email: string | null; phone: string | null; website: string | null; footer: string | null };
  lines: QuoteDocLine[];
}

function date(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function unitLabel(unit: string, quantity: number) {
  return quantity === 1 || unit.endsWith("s") ? unit : `${unit}s`;
}

export function QuoteDocument({ quote, className, compact = false }: { quote: QuoteDoc; className?: string; compact?: boolean }) {
  const money = (amount: number) => formatMoney(amount, quote.currency);
  // Columns nobody needs stay out of the way.
  const hasDiscount = quote.lines.some((line) => line.discount > 0);
  const hasTax = quote.lines.some((line) => line.taxRatePercent > 0);
  const columns = 4 + (hasDiscount ? 1 : 0) + (hasTax ? 1 : 0);
  const sellerLines = [
    quote.seller.legalName && quote.seller.legalName !== quote.seller.name ? quote.seller.legalName : null,
    quote.seller.address,
    quote.seller.taxId ? `${quote.currency === "INR" ? "GSTIN" : "Tax ID"}: ${quote.seller.taxId}` : null,
    [quote.seller.email, quote.seller.phone].filter(Boolean).join(" · ") || null,
    quote.seller.website,
  ].filter(Boolean);
  const recipient = [quote.contact?.name ? [quote.contact.name, quote.contact.title].filter(Boolean).join(", ") : null, quote.lead.address ?? quote.lead.city, quote.contact?.email ?? quote.lead.email].filter(Boolean);

  return (
    <article className={`rounded-lg bg-white text-[#16161a] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.12)] ring-1 ring-black/5 ${compact ? "p-5 sm:p-7" : "p-6 sm:p-10"} ${className ?? ""}`} aria-label={`Quote ${quote.number}`}>
      <header className="flex flex-col gap-6 border-b border-[#e3e4e8] pb-6 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <p className="text-xl font-semibold tracking-[-0.01em]">{quote.seller.name}</p>
          <div className="mt-1.5 grid gap-0.5 text-xs text-[#6b7280]">
            {sellerLines.map((line) => (
              <p key={line as string}>{line}</p>
            ))}
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-[#6b7280]">QUOTE</p>
          <p className="text-lg font-semibold whitespace-nowrap">{quote.number}</p>
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-xs sm:justify-end">
            <dt className="text-[#6b7280]">Date</dt>
            <dd className="text-right tabular">{date(quote.sentAt ?? quote.createdAt)}</dd>
            <dt className="text-[#6b7280]">Valid until</dt>
            <dd className="text-right tabular">{date(quote.validUntil)}</dd>
          </dl>
        </div>
      </header>

      <section className="py-6">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-[#6b7280]">PREPARED FOR</p>
        <p className="mt-1 text-[15px] font-semibold">{quote.lead.name}</p>
        {recipient.map((line) => (
          <p key={line as string} className="text-[13px] text-[#6b7280]">
            {line}
          </p>
        ))}
      </section>

      {quote.title || quote.notes ? (
        <section className="pb-6">
          {quote.title ? <h2 className="text-base font-semibold">{quote.title}</h2> : null}
          {quote.notes ? <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{quote.notes}</p> : null}
        </section>
      ) : null}

      <div className="-mx-2 overflow-x-auto px-2">
        <table className={`w-full text-left ${compact ? "min-w-[420px] text-xs" : "min-w-[520px] text-[13px]"}`}>
          <thead>
            <tr className="bg-[#f6f7f8] text-[10px] font-semibold tracking-[0.08em] text-[#6b7280]">
              <th className="rounded-l px-3 py-2 font-semibold">ITEM</th>
              <th className="px-3 py-2 text-right font-semibold">QTY</th>
              <th className="px-3 py-2 text-right font-semibold">RATE</th>
              {hasDiscount ? <th className="px-3 py-2 text-right font-semibold">DISCOUNT</th> : null}
              {hasTax ? <th className="px-3 py-2 text-right font-semibold">TAX</th> : null}
              <th className="rounded-r px-3 py-2 text-right font-semibold">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.length === 0 ? (
              <tr>
                <td colSpan={columns} className="px-3 py-8 text-center text-xs text-[#9ca3af]">
                  No items yet
                </td>
              </tr>
            ) : (
              quote.lines.map((line, index) => (
                <tr key={line.id ?? index} className="border-b border-[#eceef1] align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold">{line.description}</p>
                    {line.details ? <p className="mt-0.5 text-xs text-[#6b7280]">{line.details}</p> : null}
                    {line.setupFee > 0 ? <p className="mt-0.5 text-xs text-[#6b7280]">Includes setup fee {money(line.setupFee)}</p> : null}
                    {line.appliedRules
                      .filter((rule) => rule.amount > 0)
                      .map((rule) => (
                        <p key={rule.name} className="mt-0.5 text-xs text-[#6b7280]" title={rule.detail}>
                          {rule.name} (−{money(rule.amount)})
                        </p>
                      ))}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap tabular">
                    {line.quantity.toLocaleString("en-IN")} {unitLabel(line.unit, line.quantity)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap tabular">{line.unitPrice === null ? <span className="text-[#b45309]">To confirm</span> : money(line.unitPrice)}</td>
                  {hasDiscount ? <td className={`px-3 py-3 text-right whitespace-nowrap tabular ${line.discount > 0 ? "text-[#15803d]" : "text-[#9ca3af]"}`}>{line.discount > 0 ? `−${money(line.discount)}` : "—"}</td> : null}
                  {hasTax ? <td className="px-3 py-3 text-right whitespace-nowrap text-[#6b7280] tabular">{line.taxRatePercent ? `${line.taxRatePercent}%` : "—"}</td> : null}
                  <td className="px-3 py-3 text-right font-semibold whitespace-nowrap tabular">{money(line.lineTotal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex justify-end">
        <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px]">
          <dt className="text-[#6b7280]">Subtotal</dt>
          <dd className="text-right tabular">{money(quote.subtotal)}</dd>
          {quote.discountTotal > 0 ? (
            <>
              <dt className="text-[#6b7280]">Discount</dt>
              <dd className="text-right text-[#15803d] tabular">−{money(quote.discountTotal)}</dd>
            </>
          ) : null}
          {quote.taxTotal > 0 ? (
            <>
              <dt className="text-[#6b7280]">{quote.taxLabel}</dt>
              <dd className="text-right tabular">{money(quote.taxTotal)}</dd>
            </>
          ) : null}
          <dt className="mt-1.5 border-t border-[#16161a] pt-2 text-sm font-semibold">Total ({quote.currency})</dt>
          <dd className="mt-1.5 border-t border-[#16161a] pt-2 text-right text-lg font-semibold tabular">{money(quote.total)}</dd>
        </dl>
      </div>

      {quote.status === "ACCEPTED" && quote.acceptedAt ? (
        <p className="mt-6 inline-flex rounded-md border border-[#15803d]/40 bg-[#f0fdf4] px-3 py-1.5 text-xs font-semibold text-[#15803d]">
          Accepted{quote.respondedByName ? ` by ${quote.respondedByName}` : ""} on {date(quote.acceptedAt)}
        </p>
      ) : null}

      {quote.terms ? (
        <section className="mt-8">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-[#6b7280]">TERMS</p>
          <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-[#6b7280]">{quote.terms}</p>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-[#eceef1] pt-3 text-[11px] text-[#9ca3af]">{quote.seller.footer ?? [quote.seller.name, quote.seller.website].filter(Boolean).join(" · ")}</footer>
    </article>
  );
}
