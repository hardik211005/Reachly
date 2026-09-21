import { addMonths } from "date-fns";

/**
 * Billing periods are monthly anniversaries of the subscription's period start.
 * Returns the period containing `now`.
 */
export function currentBillingPeriod(anchorStart: Date, now: Date = new Date()): { start: Date; end: Date } {
  let start = new Date(anchorStart);
  if (start > now) return { start, end: addMonths(start, 1) };
  // Jump close to `now` first, then step, so very old anchors stay cheap.
  const monthsApart =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (monthsApart > 1) start = addMonths(start, monthsApart - 1);
  while (addMonths(start, 1) <= now) start = addMonths(start, 1);
  return { start, end: addMonths(start, 1) };
}

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}
