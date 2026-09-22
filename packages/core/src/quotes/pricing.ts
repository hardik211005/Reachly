/**
 * Quote pricing. Pure functions: prices come only from the catalog (offerings + pricing
 * rules) or from a price a user typed in. Nothing here — and no AI agent — ever invents a
 * price. Amounts are computed in paise (integer minor units) and returned in major units.
 */

export type PricingRuleType = "VOLUME_DISCOUNT_PERCENT" | "PERCENT_DISCOUNT" | "FIXED_DISCOUNT" | "MIN_QUANTITY" | "SETUP_FEE_WAIVER";

export interface CatalogOffering {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number | null;
  setupFee: number | null;
  taxRatePercent: number | null;
  minOrderQuantity: number | null;
  currency: string;
  isActive: boolean;
}

export interface CatalogRule {
  id: string;
  name: string;
  type: PricingRuleType;
  offeringId: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  value: number;
  priority: number;
  isActive: boolean;
}

export interface LineInput {
  offeringId?: string | null;
  /** Required for custom lines; defaults to the offering name. */
  description?: string | null;
  details?: string | null;
  quantity: number;
  unit?: string | null;
  /** A price typed by a user. Overrides the catalog and skips pricing rules. */
  unitPrice?: number | null;
  setupFee?: number | null;
  /** Extra discount amount for the whole line, agreed by a user. */
  discount?: number | null;
  taxRatePercent?: number | null;
}

export interface AppliedRule {
  ruleId: string | null;
  name: string;
  type: PricingRuleType | "MANUAL_DISCOUNT";
  /** Discount amount this rule produced (0 for rules that only check). */
  amount: number;
  detail: string;
}

export interface PricedLine {
  offeringId: string | null;
  description: string;
  details: string | null;
  quantity: number;
  unit: string;
  /** null when neither the catalog nor a user supplied a price. */
  unitPrice: number | null;
  setupFee: number;
  discount: number;
  taxRatePercent: number;
  /** quantity × unit price + setup fee */
  subtotal: number;
  /** subtotal − discount (before tax) */
  lineTotal: number;
  tax: number;
  priceSource: "catalog" | "manual" | "missing";
  appliedRules: AppliedRule[];
  /** Problems that must be fixed before the quote can be sent. */
  issues: string[];
}

export interface QuoteTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

const toPaise = (amount: number) => Math.round(amount * 100);
const fromPaise = (paise: number) => paise / 100;

export function formatMoney(amount: number, currency: string, options: { decimals?: boolean } = {}): string {
  const decimals = options.decimals ?? true;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(amount);
}

function plural(unit: string, quantity: number): string {
  if (quantity === 1 || !unit || unit.endsWith("s")) return unit;
  return `${unit}s`;
}

function quantityRange(rule: CatalogRule, unit: string): string {
  if (rule.minQuantity && rule.maxQuantity) return `for ${rule.minQuantity}–${rule.maxQuantity} ${plural(unit, rule.maxQuantity)}`;
  if (rule.minQuantity) return `from ${rule.minQuantity} ${plural(unit, rule.minQuantity)}`;
  if (rule.maxQuantity) return `up to ${rule.maxQuantity} ${plural(unit, rule.maxQuantity)}`;
  return "";
}

/** Plain-English description of a rule, e.g. "10% off Growth starter bundle from 6 months". */
export function describeRule(rule: Pick<CatalogRule, "type" | "value" | "minQuantity" | "maxQuantity">, target: { name: string; unit: string } | null, currency = "INR"): string {
  const on = target ? target.name : "every item";
  const unit = target?.unit ?? "unit";
  const range = quantityRange(rule as CatalogRule, unit);
  switch (rule.type) {
    case "VOLUME_DISCOUNT_PERCENT":
    case "PERCENT_DISCOUNT":
      return [`${rule.value}% off ${on}`, range].filter(Boolean).join(" ");
    case "FIXED_DISCOUNT":
      return [`${formatMoney(rule.value, currency, { decimals: false })} off ${on}`, range].filter(Boolean).join(" ");
    case "MIN_QUANTITY":
      return `Minimum order of ${rule.value} ${plural(unit, rule.value)} for ${on}`;
    case "SETUP_FEE_WAIVER":
      return [`Setup fee waived on ${on}`, range].filter(Boolean).join(" ");
  }
}

function inRange(rule: CatalogRule, quantity: number): boolean {
  return (rule.minQuantity === null || quantity >= rule.minQuantity) && (rule.maxQuantity === null || quantity <= rule.maxQuantity);
}

/** Prices one line from the catalog (or a user's price) and explains every adjustment. */
export function priceLine(input: LineInput, offering: CatalogOffering | null, rules: CatalogRule[], options: { currency: string; defaultTaxRate?: number } = { currency: "INR" }): PricedLine {
  const quantity = Math.max(1, Math.floor(input.quantity));
  const unit = input.unit?.trim() || offering?.unit || "unit";
  const description = input.description?.trim() || offering?.name || "Item";
  const issues: string[] = [];
  const appliedRules: AppliedRule[] = [];

  const manualPrice = input.unitPrice !== undefined && input.unitPrice !== null;
  const catalogPrice = offering?.unitPrice ?? null;
  const unitPrice = manualPrice ? input.unitPrice! : catalogPrice;
  const priceSource: PricedLine["priceSource"] = manualPrice ? "manual" : catalogPrice !== null ? "catalog" : "missing";
  if (priceSource === "missing") issues.push(`${description} has no list price — enter the price you've agreed`);
  if (offering && !offering.isActive) issues.push(`${offering.name} is no longer offered`);
  if (offering && offering.currency !== options.currency) issues.push(`${offering.name} is priced in ${offering.currency}, but this quote is in ${options.currency}`);

  const unitPaise = unitPrice === null ? 0 : toPaise(unitPrice);
  let setupPaise = toPaise(input.setupFee ?? offering?.setupFee ?? 0);
  const itemsPaise = unitPaise * quantity;
  let discountPaise = 0;

  const minimum = offering?.minOrderQuantity ?? null;
  if (minimum && quantity < minimum) issues.push(`Minimum order for ${offering!.name} is ${minimum} ${plural(unit, minimum)}`);

  // Pricing rules apply to catalog prices only; a typed price is already the agreed price.
  if (offering && priceSource === "catalog") {
    const relevant = rules
      .filter((rule) => rule.isActive && (rule.offeringId === null || rule.offeringId === offering.id))
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const target = (rule: CatalogRule) => (rule.offeringId ? { name: offering.name, unit } : null);

    for (const rule of relevant.filter((item) => item.type === "MIN_QUANTITY")) {
      if (quantity < rule.value) {
        issues.push(`Minimum order for ${offering.name} is ${rule.value} ${plural(unit, rule.value)} (${rule.name})`);
        appliedRules.push({ ruleId: rule.id, name: rule.name, type: rule.type, amount: 0, detail: describeRule(rule, target(rule), options.currency) });
      }
    }

    let percent = 0;
    const volume = relevant.filter((rule) => rule.type === "VOLUME_DISCOUNT_PERCENT" && inRange(rule, quantity)).sort((a, b) => b.value - a.value || b.priority - a.priority)[0];
    const percentRules = [...(volume ? [volume] : []), ...relevant.filter((rule) => rule.type === "PERCENT_DISCOUNT" && inRange(rule, quantity))];
    for (const rule of percentRules) {
      const share = Math.min(rule.value, 100 - percent);
      if (share <= 0) continue;
      percent += share;
      const amount = Math.round((itemsPaise * share) / 100);
      discountPaise += amount;
      appliedRules.push({ ruleId: rule.id, name: rule.name, type: rule.type, amount: fromPaise(amount), detail: describeRule(rule, target(rule), options.currency) });
    }
    for (const rule of relevant.filter((item) => item.type === "FIXED_DISCOUNT" && inRange(item, quantity))) {
      const amount = Math.min(toPaise(rule.value), itemsPaise + setupPaise - discountPaise);
      if (amount <= 0) continue;
      discountPaise += amount;
      appliedRules.push({ ruleId: rule.id, name: rule.name, type: rule.type, amount: fromPaise(amount), detail: describeRule(rule, target(rule), options.currency) });
    }
    const waiver = relevant.find((rule) => rule.type === "SETUP_FEE_WAIVER" && inRange(rule, quantity));
    if (waiver && setupPaise > 0) {
      discountPaise += setupPaise;
      appliedRules.push({ ruleId: waiver.id, name: waiver.name, type: waiver.type, amount: fromPaise(setupPaise), detail: describeRule(waiver, target(waiver), options.currency) });
    }
  }

  const manualDiscount = toPaise(Math.max(0, input.discount ?? 0));
  if (manualDiscount > 0) {
    const amount = Math.min(manualDiscount, itemsPaise + setupPaise - discountPaise);
    discountPaise += amount;
    appliedRules.push({ ruleId: null, name: "Discount", type: "MANUAL_DISCOUNT", amount: fromPaise(amount), detail: "Agreed discount" });
  }

  if (priceSource === "missing") setupPaise = 0;
  const subtotalPaise = itemsPaise + setupPaise;
  discountPaise = Math.min(discountPaise, subtotalPaise);
  const lineTotalPaise = subtotalPaise - discountPaise;
  const taxRatePercent = input.taxRatePercent ?? offering?.taxRatePercent ?? options.defaultTaxRate ?? 0;
  const taxPaise = Math.round((lineTotalPaise * taxRatePercent) / 100);

  return {
    offeringId: offering?.id ?? null,
    description,
    details: input.details?.trim() || (input.offeringId ? offering?.description ?? null : null),
    quantity,
    unit,
    unitPrice,
    setupFee: fromPaise(setupPaise),
    discount: fromPaise(discountPaise),
    taxRatePercent,
    subtotal: fromPaise(subtotalPaise),
    lineTotal: fromPaise(lineTotalPaise),
    tax: fromPaise(taxPaise),
    priceSource,
    appliedRules,
    issues,
  };
}

export function quoteTotals(lines: Array<Pick<PricedLine, "subtotal" | "discount" | "tax">>): QuoteTotals {
  const subtotal = lines.reduce((sum, line) => sum + toPaise(line.subtotal), 0);
  const discountTotal = lines.reduce((sum, line) => sum + toPaise(line.discount), 0);
  const taxTotal = lines.reduce((sum, line) => sum + toPaise(line.tax), 0);
  return { subtotal: fromPaise(subtotal), discountTotal: fromPaise(discountTotal), taxTotal: fromPaise(taxTotal), total: fromPaise(subtotal - discountTotal + taxTotal) };
}

/** Prices every line of a quote against the catalog. */
export function priceQuote(lines: LineInput[], catalog: { offerings: CatalogOffering[]; rules: CatalogRule[] }, options: { currency: string; defaultTaxRate?: number }) {
  const byId = new Map(catalog.offerings.map((offering) => [offering.id, offering]));
  const priced = lines.map((line) => {
    const offering = line.offeringId ? (byId.get(line.offeringId) ?? null) : null;
    const result = priceLine(line, offering, catalog.rules, options);
    if (line.offeringId && !offering) result.issues.push("This catalog item was removed — pick another or enter a custom line");
    return result;
  });
  return { lines: priced, totals: quoteTotals(priced), issues: priced.flatMap((line) => line.issues) };
}
