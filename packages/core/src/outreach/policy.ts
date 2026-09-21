import type { Channel } from "@repo/db";
import { z } from "zod";
import { isSuppressed } from "../compliance/suppression";
import type { TenantContext } from "../context";

/**
 * Outreach policy — the checks every send path runs before contacting anyone.
 * Returns a machine-readable reason when a send must not happen, never silently skips.
 */

export const quietHoursSchema = z.object({
  start: z.number().int().min(0).max(23).default(9),
  end: z.number().int().min(1).max(24).default(19),
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
});
export type QuietHours = z.infer<typeof quietHoursSchema>;

export type BlockReason =
  | "SUPPRESSED"
  | "DO_NOT_CONTACT"
  | "NO_CONTACT_DETAIL"
  | "WHATSAPP_NO_OPT_IN"
  | "SIMULATED_LEAD_REAL_PROVIDER"
  | "OUTSIDE_SEND_WINDOW"
  | "DAILY_LIMIT_REACHED";

export class OutreachBlockedError extends Error {
  readonly retryable = false;
  override name = "OutreachBlockedError";
  constructor(
    public readonly reason: BlockReason,
    message: string,
  ) {
    super(message);
  }
}

/** Local weekday/hour in a timezone. */
export function localParts(date: Date, timezone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName), hour, minute };
}

export function withinSendWindow(date: Date, timezone: string, window: QuietHours): boolean {
  const { weekday, hour } = localParts(date, timezone);
  return window.days.includes(weekday) && hour >= window.start && hour < window.end;
}

/** Next moment (≥ from) inside the send window, searched in 15-minute steps up to 8 days. */
export function nextSendWindow(from: Date, timezone: string, window: QuietHours): Date {
  if (withinSendWindow(from, timezone, window)) return from;
  const step = 15 * 60_000;
  let cursor = new Date(Math.ceil(from.getTime() / step) * step);
  for (let i = 0; i < (8 * 24 * 60) / 15; i += 1) {
    if (withinSendWindow(cursor, timezone, window)) return cursor;
    cursor = new Date(cursor.getTime() + step);
  }
  return from;
}

/** Start of "today" in the organisation's timezone, as a UTC instant. */
export function startOfLocalDay(date: Date, timezone: string): Date {
  const { hour, minute } = localParts(date, timezone);
  const start = new Date(date.getTime() - (hour * 60 + minute) * 60_000);
  start.setUTCSeconds(0, 0);
  return start;
}

export interface OutreachTarget {
  leadId: string;
  doNotContact: boolean;
  sourceProvider: string;
  email: string | null;
  phone: string | null;
  whatsappOptIn: boolean;
}

export async function assertCanContact(
  ctx: TenantContext,
  target: OutreachTarget,
  options: { channel: Channel; campaignId: string | null; providerIsMock: boolean },
): Promise<void> {
  if (target.doNotContact) throw new OutreachBlockedError("DO_NOT_CONTACT", "Lead is on the do-not-contact list");
  const compliance = await ctx.db.complianceSettings.findFirst();

  if (options.channel === "EMAIL" && !target.email) throw new OutreachBlockedError("NO_CONTACT_DETAIL", "No email address for this lead");
  if (options.channel === "WHATSAPP") {
    if (!target.phone) throw new OutreachBlockedError("NO_CONTACT_DETAIL", "No WhatsApp number for this lead");
    if ((compliance?.whatsappRequireOptIn ?? true) && !target.whatsappOptIn) {
      throw new OutreachBlockedError("WHATSAPP_NO_OPT_IN", "WhatsApp requires recorded opt-in before business-initiated messages");
    }
  }
  if (target.sourceProvider === "mock" && !options.providerIsMock && (compliance?.blockSimulatedLeadsOnRealProviders ?? true)) {
    throw new OutreachBlockedError("SIMULATED_LEAD_REAL_PROVIDER", "Demo-data leads are fictional and can't be contacted through a real provider");
  }
  const suppression = await isSuppressed(
    ctx,
    { leadId: target.leadId, email: target.email, phone: target.phone },
    { channel: options.channel, campaignId: options.campaignId },
  );
  if (suppression.suppressed) throw new OutreachBlockedError("SUPPRESSED", `Suppressed (${suppression.reason.toLowerCase()})`);
}

/** Messages already sent today on a channel for a campaign (for daily limits). */
export async function sentToday(ctx: TenantContext, campaignId: string, channel: Channel, timezone: string): Promise<number> {
  return ctx.db.message.count({
    where: {
      campaignId,
      channel,
      direction: "OUTBOUND",
      sentAt: { gte: startOfLocalDay(new Date(), timezone) },
    },
  });
}
