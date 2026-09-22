import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { brand } from "@repo/config";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { logger } from "../logger";
import { formatMoney } from "./pricing";
import type { QuoteView } from "./service";

/**
 * Quote PDF (A4). Inter is embedded so ₹ and other symbols render; if the font files
 * can't be found the PDF still renders with Helvetica and "Rs." amounts.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.88, 0.89, 0.91);
const SHADE = rgb(0.965, 0.968, 0.973);
const GOOD = rgb(0.09, 0.5, 0.29);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Standard fonts only encode WinAnsi, so text is simplified for them. */
  simple: boolean;
}

let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array } | null> | null = null;

function fontDirs(): string[] {
  const dirs = [path.resolve(process.cwd(), "assets/fonts"), path.resolve(process.cwd(), "packages/core/assets/fonts"), path.resolve(process.cwd(), "../../packages/core/assets/fonts")];
  if (process.env.PDF_FONT_DIR) dirs.unshift(process.env.PDF_FONT_DIR);
  try {
    // Unbundled runs (tests, scripts, worker via tsx) resolve relative to this file.
    dirs.push(fileURLToPath(new URL(["..", "..", "assets", "fonts"].join("/"), import.meta.url)));
  } catch {
    // import.meta.url isn't a file URL inside some bundles.
  }
  return dirs;
}

async function loadFontBytes() {
  for (const dir of fontDirs()) {
    try {
      const [regular, bold] = await Promise.all([readFile(path.join(dir, "Inter-Regular.ttf")), readFile(path.join(dir, "Inter-SemiBold.ttf"))]);
      return { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
    } catch {
      // try the next location
    }
  }
  logger.warn("quote PDF fonts not found; falling back to Helvetica");
  return null;
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  fontBytes ??= loadFontBytes();
  const bytes = await fontBytes;
  if (bytes) {
    doc.registerFontkit(fontkit);
    return { regular: await doc.embedFont(bytes.regular, { subset: false }), bold: await doc.embedFont(bytes.bold, { subset: false }), simple: false };
  }
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), simple: true };
}

class Writer {
  page: PDFPage;
  y: number;
  readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = this.addPage();
    this.y = PAGE.height - PAGE.margin;
  }

  private addPage(): PDFPage {
    const page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  text(value: string): string {
    if (!this.fonts.simple) return value;
    return value
      .replace(/₹\s?/g, "Rs. ")
      .replace(/[−–]/g, "-")
      .replace(/→/g, "->")
      .replace(/[^\x20-\x7E\u00A0-\u00FF\u2014\u2018\u2019\u201C\u201D\u2022\u2026\n]/g, "?");
  }

  width(value: string, size: number, bold = false): number {
    return (bold ? this.fonts.bold : this.fonts.regular).widthOfTextAtSize(this.text(value), size);
  }

  /** Starts a new page when fewer than `needed` points remain. */
  ensure(needed: number, onNewPage?: () => void) {
    if (this.y - needed >= PAGE.margin + 28) return;
    this.page = this.addPage();
    this.y = PAGE.height - PAGE.margin;
    onNewPage?.();
  }

  draw(value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right"; width?: number } = {}) {
    const size = options.size ?? 10;
    const text = this.text(value);
    const font = options.bold ? this.fonts.bold : this.fonts.regular;
    const drawX = options.align === "right" ? x + (options.width ?? 0) - font.widthOfTextAtSize(text, size) : x;
    this.page.drawText(text, { x: drawX, y, size, font, color: options.color ?? INK });
  }

  wrap(value: string, maxWidth: number, size: number, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (this.width(candidate, size, bold) <= maxWidth) current = candidate;
        else {
          if (current) lines.push(current);
          // Break words longer than a whole line (URLs).
          let rest = word;
          while (this.width(rest, size, bold) > maxWidth && rest.length > 1) {
            let cut = rest.length - 1;
            while (cut > 1 && this.width(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          current = rest;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  paragraph(value: string, options: { x?: number; width?: number; size?: number; color?: ReturnType<typeof rgb>; bold?: boolean; leading?: number } = {}) {
    const size = options.size ?? 10;
    const leading = options.leading ?? size * 1.45;
    for (const line of this.wrap(value, options.width ?? PAGE.width - PAGE.margin * 2, size, options.bold)) {
      this.ensure(leading);
      this.draw(line, options.x ?? PAGE.margin, this.y - size, { size, color: options.color, bold: options.bold });
      this.y -= leading;
    }
  }

  rule(y = this.y, color = RULE) {
    this.page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.75, color });
  }
}

function unitLabel(unit: string, quantity: number): string {
  return quantity === 1 || unit.endsWith("s") ? unit : `${unit}s`;
}

function dateText(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

const COLUMNS = (() => {
  const content = PAGE.width - PAGE.margin * 2;
  const qty = 48;
  const rate = 78;
  const discount = 70;
  const tax = 38;
  const amount = 84;
  const item = content - qty - rate - discount - tax - amount;
  let x = PAGE.margin;
  const col = (width: number) => {
    const start = x;
    x += width;
    return { x: start, width };
  };
  return { item: col(item), qty: col(qty), rate: col(rate), discount: col(discount), tax: col(tax), amount: col(amount) };
})();

export async function renderQuotePdf(view: QuoteView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quote ${view.number}${view.title ? ` — ${view.title}` : ""}`);
  doc.setAuthor(view.seller.legalName ?? view.seller.name);
  doc.setSubject(`Quote for ${view.lead.name}`);
  doc.setCreator(brand.name);
  doc.setProducer(brand.name);
  doc.setCreationDate(new Date(view.createdAt));

  const fonts = await embedFonts(doc);
  const w = new Writer(doc, fonts);
  const money = (amount: number) => formatMoney(amount, view.currency);
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const content = right - left;

  // ---- Header: seller (left), quote meta (right)
  const top = w.y;
  w.draw(view.seller.name, left, top - 18, { size: 18, bold: true });
  let sellerY = top - 36;
  const sellerLines = [
    view.seller.legalName && view.seller.legalName !== view.seller.name ? view.seller.legalName : null,
    view.seller.address,
    view.seller.taxId ? `${view.currency === "INR" ? "GSTIN" : "Tax ID"}: ${view.seller.taxId}` : null,
    [view.seller.email, view.seller.phone].filter(Boolean).join(" · ") || null,
    view.seller.website,
  ].filter((line): line is string => Boolean(line));
  for (const line of sellerLines) {
    for (const wrapped of w.wrap(line, content * 0.55, 9)) {
      w.draw(wrapped, left, sellerY, { size: 9, color: MUTED });
      sellerY -= 13;
    }
  }

  const metaWidth = 190;
  const metaX = right - metaWidth;
  w.draw("QUOTE", metaX, top - 10, { size: 8.5, bold: true, color: MUTED, align: "right", width: metaWidth });
  w.draw(view.number, metaX, top - 28, { size: 15, bold: true, align: "right", width: metaWidth });
  const meta: Array<[string, string]> = [
    ["Date", dateText(view.sentAt ?? view.createdAt)],
    ["Valid until", dateText(view.validUntil)],
  ];
  let metaY = top - 46;
  for (const [label, value] of meta) {
    w.draw(label, metaX + 40, metaY, { size: 9, color: MUTED });
    w.draw(value, metaX, metaY, { size: 9, align: "right", width: metaWidth });
    metaY -= 14;
  }
  w.y = Math.min(sellerY, metaY) - 10;
  w.rule();
  w.y -= 22;

  // ---- Prepared for
  w.draw("PREPARED FOR", left, w.y, { size: 8, bold: true, color: MUTED });
  w.y -= 16;
  w.draw(view.lead.name, left, w.y, { size: 11.5, bold: true });
  w.y -= 15;
  const recipient = [
    view.contact?.name ? [view.contact.name, view.contact.title].filter(Boolean).join(", ") : null,
    view.lead.address ?? view.lead.city,
    view.contact?.email ?? view.lead.email,
  ].filter((line): line is string => Boolean(line));
  for (const line of recipient) {
    w.draw(line, left, w.y, { size: 9.5, color: MUTED });
    w.y -= 13.5;
  }
  w.y -= 12;

  // ---- Title and cover note
  if (view.title) {
    w.paragraph(view.title, { size: 13, bold: true, leading: 18 });
    w.y -= 2;
  }
  if (view.notes) {
    w.paragraph(view.notes, { size: 10, color: INK, leading: 14.5 });
  }
  w.y -= 14;

  // ---- Items table
  const header = () => {
    const height = 22;
    w.page.drawRectangle({ x: left, y: w.y - height, width: content, height, color: SHADE });
    const baseline = w.y - 14.5;
    const labels: Array<[keyof typeof COLUMNS, string, "left" | "right"]> = [
      ["item", "ITEM", "left"],
      ["qty", "QTY", "right"],
      ["rate", "RATE", "right"],
      ["discount", "DISCOUNT", "right"],
      ["tax", "TAX", "right"],
      ["amount", "AMOUNT", "right"],
    ];
    for (const [key, label, align] of labels) {
      const column = COLUMNS[key];
      w.draw(label, column.x + (align === "left" ? 8 : 0), baseline, { size: 7.5, bold: true, color: MUTED, align, width: column.width - (align === "right" ? 8 : 0) });
    }
    w.y -= height + 8;
  };
  header();

  for (const line of view.lines) {
    const itemWidth = COLUMNS.item.width - 16;
    const title = w.wrap(line.description, itemWidth, 10, true);
    const extras: string[] = [];
    if (line.details) extras.push(...w.wrap(line.details, itemWidth, 8.5));
    if (line.setupFee > 0) extras.push(`Includes setup fee ${money(line.setupFee)}`);
    for (const rule of line.appliedRules.filter((applied) => applied.amount > 0)) extras.push(...w.wrap(`${rule.name} (−${money(rule.amount)})`, itemWidth, 8.5));
    const height = title.length * 14 + extras.length * 12 + 10;
    w.ensure(height, header);
    const rowTop = w.y;
    let textY = rowTop - 10;
    for (const part of title) {
      w.draw(part, COLUMNS.item.x + 8, textY, { size: 10, bold: true });
      textY -= 14;
    }
    for (const part of extras) {
      w.draw(part, COLUMNS.item.x + 8, textY + 1.5, { size: 8.5, color: MUTED });
      textY -= 12;
    }
    const numberY = rowTop - 10;
    const pad = { align: "right" as const };
    w.draw(`${line.quantity.toLocaleString("en-IN")} ${unitLabel(line.unit, line.quantity)}`, COLUMNS.qty.x, numberY, { size: 9.5, ...pad, width: COLUMNS.qty.width - 8 });
    w.draw(line.unitPrice === null ? "—" : money(line.unitPrice), COLUMNS.rate.x, numberY, { size: 9.5, ...pad, width: COLUMNS.rate.width - 8 });
    w.draw(line.discount > 0 ? `−${money(line.discount)}` : "—", COLUMNS.discount.x, numberY, { size: 9.5, color: line.discount > 0 ? GOOD : MUTED, ...pad, width: COLUMNS.discount.width - 8 });
    w.draw(line.taxRatePercent > 0 ? `${line.taxRatePercent}%` : "—", COLUMNS.tax.x, numberY, { size: 9.5, color: MUTED, ...pad, width: COLUMNS.tax.width - 8 });
    w.draw(money(line.lineTotal), COLUMNS.amount.x, numberY, { size: 9.5, bold: true, ...pad, width: COLUMNS.amount.width - 8 });
    w.y = rowTop - height;
    w.rule(w.y + 4);
  }

  // ---- Totals
  const rows: Array<[string, string, boolean]> = [
    ["Subtotal", money(view.subtotal), false],
    ...(view.discountTotal > 0 ? ([["Discount", `−${money(view.discountTotal)}`, false]] as Array<[string, string, boolean]>) : []),
    ...(view.taxTotal > 0 ? ([[view.taxLabel, money(view.taxTotal), false]] as Array<[string, string, boolean]>) : []),
  ];
  w.ensure(rows.length * 16 + 50);
  w.y -= 10;
  const totalsX = right - 230;
  for (const [label, value] of rows) {
    w.draw(label, totalsX, w.y - 10, { size: 9.5, color: MUTED });
    w.draw(value, totalsX, w.y - 10, { size: 9.5, align: "right", width: 230 - 8 });
    w.y -= 16;
  }
  w.page.drawLine({ start: { x: totalsX, y: w.y - 2 }, end: { x: right, y: w.y - 2 }, thickness: 1, color: INK });
  w.y -= 8;
  w.draw(`Total (${view.currency})`, totalsX, w.y - 13, { size: 11, bold: true });
  w.draw(money(view.total), totalsX, w.y - 13, { size: 13, bold: true, align: "right", width: 230 - 8 });
  w.y -= 34;

  // ---- Status stamp
  if (view.status === "ACCEPTED" && view.acceptedAt) {
    w.ensure(40);
    const text = `Accepted${view.respondedByName ? ` by ${view.respondedByName}` : ""} on ${dateText(view.acceptedAt)}`;
    const width = w.width(text, 9.5, true) + 24;
    w.page.drawRectangle({ x: left, y: w.y - 24, width, height: 24, borderColor: GOOD, borderWidth: 1, color: rgb(0.93, 0.98, 0.95) });
    w.draw(text, left + 12, w.y - 15.5, { size: 9.5, bold: true, color: GOOD });
    w.y -= 40;
  }

  // ---- Terms
  if (view.terms) {
    w.ensure(40);
    w.draw("TERMS", left, w.y - 8, { size: 8, bold: true, color: MUTED });
    w.y -= 18;
    w.paragraph(view.terms, { size: 8.5, color: MUTED, leading: 12.5 });
  }

  // ---- Footer on every page
  const total = w.pages.length;
  w.pages.forEach((page, index) => {
    w.page = page;
    const footer = view.seller.footer ?? [view.seller.name, view.seller.website].filter(Boolean).join(" · ");
    w.draw(footer, left, 26, { size: 7.5, color: MUTED });
    w.draw(`${view.number} · Page ${index + 1} of ${total}`, left, 26, { size: 7.5, color: MUTED, align: "right", width: content });
  });

  return doc.save();
}
