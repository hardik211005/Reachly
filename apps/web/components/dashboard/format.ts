import { formatCurrency, formatNumber, formatPercent } from "@repo/ui";

export type KpiFormat = "number" | "percent" | "currency" | "cost";

export function formatKpi(value: number, format: KpiFormat, currency: string): string {
  switch (format) {
    case "percent":
      return formatPercent(value);
    case "currency":
      return formatCurrency(value, currency, { compact: value >= 100_000 });
    case "cost":
      return formatCurrency(value, currency, { decimals: value < 1_000 ? 2 : 0 });
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
