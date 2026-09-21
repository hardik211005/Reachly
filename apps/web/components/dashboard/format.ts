import { formatCurrency, formatMicroUsd, formatNumber, formatPercent } from "@repo/ui";

export type KpiFormat = "number" | "percent" | "currency" | "usd_micro";

export function formatKpi(value: number, format: KpiFormat, currency: string): string {
  switch (format) {
    case "percent":
      return formatPercent(value);
    case "currency":
      return formatCurrency(value, currency, { compact: value >= 100_000 });
    case "usd_micro":
      return formatMicroUsd(value);
    default:
      return formatNumber(value);
  }
}

const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function formatDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return shortDate.format(new Date(Date.UTC(year, month - 1, day, 12)));
}
