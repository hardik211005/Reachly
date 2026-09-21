"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { useShell } from "./shell/shell-context";

/**
 * Time rendering that is identical on the server and in the browser (no hydration
 * mismatch): absolute times use the workspace timezone explicitly; relative times are
 * allowed to differ by a few seconds and opt out of the hydration check.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string, style: "datetime" | "date" | "time"): Intl.DateTimeFormat {
  const key = `${timezone}|${style}`;
  let instance = formatters.get(key);
  if (!instance) {
    instance = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      ...(style !== "time" ? { day: "numeric", month: "short" } : {}),
      ...(style !== "date" ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    });
    formatters.set(key, instance);
  }
  return instance;
}

export function LocalTime({ value, style = "datetime", className }: { value: string | Date; style?: "datetime" | "date" | "time"; className?: string }) {
  const { workspace } = useShell();
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()} className={className}>
      {formatter(workspace.timezone, style).format(date)}
    </time>
  );
}

export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()} className={className} suppressHydrationWarning>
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </time>
  );
}
