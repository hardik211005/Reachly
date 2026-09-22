import { formatCurrency, formatNumber, formatPercent } from "@repo/ui";

export type MetricFormat = "number" | "percent" | "currency" | "multiple";

export function formatMetric(value: number | null | undefined, format: MetricFormat, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "percent":
      return formatPercent(value, value < 0.1 && value > 0 ? 1 : 0);
    case "currency":
      return formatCurrency(value, currency, { compact: Math.abs(value) >= 100_000, decimals: Math.abs(value) < 100 ? 2 : 0 });
    case "multiple":
      return `${value >= 0 ? "" : "−"}${formatNumber(Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.round(Math.abs(value) * 10) / 10, { compact: Math.abs(value) >= 10_000 })}×`;
    default:
      return formatNumber(value);
  }
}

/** "+12%" for counts and money, "+4.1 pts" for rates. */
export function formatChange(delta: number | null, format: MetricFormat): string | null {
  if (delta === null || !Number.isFinite(delta)) return null;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  if (format === "percent") return `${sign}${Math.abs(delta * 100).toFixed(1).replace(/\.0$/, "")} pts`;
  if (format === "multiple") return `${sign}${Math.abs(delta).toFixed(1)}×`;
  const pct = Math.abs(delta * 100);
  return `${sign}${pct >= 100 ? formatNumber(Math.round(pct)) : pct.toFixed(1).replace(/\.0$/, "")}%`;
}

export function rateLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatPercent(value, 0);
}

const shortDate = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" });

export function formatDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return shortDate.format(new Date(Date.UTC(year, month - 1, day, 12)));
}
