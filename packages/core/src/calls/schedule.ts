import { localParts, startOfLocalDay } from "../outreach/policy";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Turns what a prospect said ("Thursday afternoon works", "tomorrow at 4pm") into a
 * concrete time in the workspace timezone. Returns null unless a day was mentioned —
 * we never invent a meeting time the prospect didn't give.
 */
export function parseSuggestedTime(text: string, timezone: string, now = new Date()): Date | null {
  const lower = text.toLowerCase();
  const today = localParts(now, timezone).weekday;
  let offset: number | null = null;
  const weekday = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(lower));
  if (weekday >= 0) offset = ((weekday - today + 7) % 7 || 7) + (/\bnext\s+(week\s+)?\w*day\b/.test(lower) && weekday > today ? 7 : 0);
  else if (/\btomorrow\b/.test(lower)) offset = 1;
  else if (/\bnext week\b/.test(lower)) offset = ((1 - today + 7) % 7 || 7);
  if (offset === null) return null;

  let hour = 15;
  const clock = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(lower) ?? /\bat\s+(\d{1,2})(?::(\d{2}))?\b/.exec(lower);
  let minutes = 0;
  if (clock?.[1]) {
    hour = Number(clock[1]) % 12;
    minutes = clock[2] ? Number(clock[2]) : 0;
    const meridiem = clock[3];
    if (meridiem === "pm" || (!meridiem && hour < 8)) hour += 12;
  } else if (/\bmorning\b/.test(lower)) hour = 11;
  else if (/\bevening\b/.test(lower)) hour = 17;
  return new Date(startOfLocalDay(now, timezone).getTime() + offset * DAY + hour * HOUR + minutes * 60_000);
}
