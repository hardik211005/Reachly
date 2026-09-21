import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en");

/** 1,284 / 12.9K / 4.2M — compact above 10k. */
export function formatNumber(value: number | null | undefined, options: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (options.compact ?? Math.abs(value) >= 10_000) return compact.format(value);
  return integer.format(Math.round(value));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function formatCurrency(
  value: number | null | undefined,
  currency = "INR",
  options: { compact?: boolean; decimals?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.decimals ?? (options.compact ? 1 : 0),
  }).format(value);
}

/** Micro-USD → "$0.0042" style display for AI costs. */
export function formatMicroUsd(micro: number | null | undefined): string {
  if (micro === null || micro === undefined) return "—";
  const dollars = micro / 1_000_000;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(dollars);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}
