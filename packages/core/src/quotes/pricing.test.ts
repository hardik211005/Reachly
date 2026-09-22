import { describe, expect, it } from "vitest";
import { describeRule, formatMoney, priceLine, priceQuote, type CatalogOffering, type CatalogRule } from "./pricing";

const cups: CatalogOffering = { id: "cups", name: "Custom paper cups", description: "Printed 8oz cups", unit: "cup", unitPrice: 2.4, setupFee: 3500, taxRatePercent: 18, minOrderQuantity: 5000, currency: "INR", isActive: true };
const retainer: CatalogOffering = { id: "social", name: "Social media management", description: null, unit: "month", unitPrice: 35000, setupFee: null, taxRatePercent: 18, minOrderQuantity: null, currency: "INR", isActive: true };
const onRequest: CatalogOffering = { id: "custom", name: "Custom packaging", description: null, unit: "project", unitPrice: null, setupFee: null, taxRatePercent: 18, minOrderQuantity: null, currency: "INR", isActive: true };

function rule(partial: Partial<CatalogRule> & Pick<CatalogRule, "type" | "value">): CatalogRule {
  return { id: partial.type, name: partial.type, offeringId: null, minQuantity: null, maxQuantity: null, priority: 0, isActive: true, ...partial };
}

const INR = { currency: "INR" };

describe("quote pricing", () => {
  it("prices from the catalog with setup fee and tax, in exact paise", () => {
    const line = priceLine({ offeringId: "cups", quantity: 10_000 }, cups, [], INR);
    expect(line).toMatchObject({ unitPrice: 2.4, setupFee: 3500, subtotal: 27_500, discount: 0, lineTotal: 27_500, tax: 4950, priceSource: "catalog", issues: [] });
  });

  it("applies the best volume tier only, plus stacked percent and fixed discounts", () => {
    const rules = [
      rule({ id: "t1", name: "5k+", type: "VOLUME_DISCOUNT_PERCENT", offeringId: "cups", minQuantity: 5000, value: 5 }),
      rule({ id: "t2", name: "10k+", type: "VOLUME_DISCOUNT_PERCENT", offeringId: "cups", minQuantity: 10_000, value: 10 }),
      rule({ id: "launch", name: "Launch offer", type: "PERCENT_DISCOUNT", value: 2 }),
      rule({ id: "flat", name: "Loyalty", type: "FIXED_DISCOUNT", offeringId: "cups", value: 500 }),
    ];
    const line = priceLine({ offeringId: "cups", quantity: 10_000 }, cups, rules, INR);
    // items 24,000 → 10% (2,400) + 2% (480) + ₹500 fixed; setup fee untouched by percentages
    expect(line.discount).toBe(3380);
    expect(line.appliedRules.map((applied) => applied.ruleId)).toEqual(["t2", "launch", "flat"]);
    expect(line.lineTotal).toBe(27_500 - 3380);
    expect(line.appliedRules[0]?.detail).toBe("10% off Custom paper cups from 10000 cups");
  });

  it("flags minimum order quantities from the offering and from rules", () => {
    const line = priceLine({ offeringId: "cups", quantity: 2000 }, cups, [rule({ type: "MIN_QUANTITY", offeringId: "cups", value: 3000, name: "Print run" })], INR);
    expect(line.issues).toEqual(["Minimum order for Custom paper cups is 5000 cups", "Minimum order for Custom paper cups is 3000 cups (Print run)"]);
  });

  it("waives the setup fee as a visible discount", () => {
    const line = priceLine({ offeringId: "cups", quantity: 20_000 }, cups, [rule({ type: "SETUP_FEE_WAIVER", offeringId: "cups", minQuantity: 20_000, value: 0 })], INR);
    expect(line.setupFee).toBe(3500);
    expect(line.discount).toBe(3500);
    expect(line.appliedRules[0]).toMatchObject({ type: "SETUP_FEE_WAIVER", amount: 3500 });
  });

  it("never invents a price: missing list prices block the quote until a user enters one", () => {
    const missing = priceLine({ offeringId: "custom", quantity: 1 }, onRequest, [], INR);
    expect(missing).toMatchObject({ unitPrice: null, priceSource: "missing", lineTotal: 0 });
    expect(missing.issues[0]).toMatch(/no list price/);

    const agreed = priceLine({ offeringId: "custom", quantity: 1, unitPrice: 42_000 }, onRequest, [rule({ type: "PERCENT_DISCOUNT", value: 10 })], INR);
    // A typed price is the agreed price: pricing rules don't apply on top of it.
    expect(agreed).toMatchObject({ unitPrice: 42_000, priceSource: "manual", discount: 0, lineTotal: 42_000, issues: [] });
  });

  it("caps discounts at the line value and supports agreed discounts", () => {
    const line = priceLine({ offeringId: "social", quantity: 1, discount: 50_000 }, retainer, [rule({ type: "PERCENT_DISCOUNT", value: 80 })], INR);
    expect(line.lineTotal).toBe(0);
    expect(line.discount).toBe(35_000);
  });

  it("totals a quote and reports every issue", () => {
    const result = priceQuote(
      [
        { offeringId: "social", quantity: 6 },
        { description: "Photo shoot", quantity: 1, unitPrice: 15_000, taxRatePercent: 18 },
        { offeringId: "gone", quantity: 1 },
      ],
      { offerings: [retainer], rules: [rule({ type: "VOLUME_DISCOUNT_PERCENT", offeringId: "social", minQuantity: 6, value: 10 })] },
      INR,
    );
    expect(result.totals).toEqual({ subtotal: 225_000, discountTotal: 21_000, taxTotal: 36_720, total: 240_720 });
    expect(result.issues).toEqual(["Item has no list price — enter the price you've agreed", "This catalog item was removed — pick another or enter a custom line"]);
  });

  it("formats money for Indian and other currencies", () => {
    expect(formatMoney(240720, "INR")).toBe("₹2,40,720.00");
    expect(formatMoney(1234.5, "USD", { decimals: false })).toBe("$1,235");
    expect(describeRule({ type: "FIXED_DISCOUNT", value: 5000, minQuantity: null, maxQuantity: 3 }, { name: "Branding", unit: "project" })).toBe("₹5,000 off Branding up to 3 projects");
  });
});
