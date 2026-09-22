import { getEnv } from "@repo/config/env";
import { z } from "zod";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { recordEvent } from "../events";
import { changeLeadStatus } from "../leads/service";

export const meetingInputSchema = z.object({
  leadId: z.uuid(),
  dealId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(480).default(30),
  location: z.string().trim().max(300).nullable().optional(),
});

export const meetingUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    scheduledAt: z.coerce.date(),
    durationMinutes: z.number().int().min(10).max(480),
    location: z.string().trim().max(300).nullable(),
    status: z.enum(["SCHEDULED", "COMPLETED", "CANCELED", "NO_SHOW"]),
  })
  .partial();

export const meetingListSchema = z.object({
  when: z.enum(["upcoming", "past"]).default("upcoming"),
  leadId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const ADVANCE_FROM = new Set(["NEW", "QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED"]);

export async function createMeeting(ctx: TenantContext, input: z.input<typeof meetingInputSchema>) {
  assertCan(ctx, "crm:write");
  const data = meetingInputSchema.parse(input);
  const lead = await ctx.db.lead.findFirst({ where: { id: data.leadId, deletedAt: null }, select: { id: true, status: true } });
  if (!lead) throw new NotFoundError("Lead", data.leadId);
  if (data.dealId && !(await ctx.db.deal.findFirst({ where: { id: data.dealId, leadId: lead.id, deletedAt: null } }))) throw new ValidationError("Deal must belong to this lead");
  const meeting = await ctx.db.meeting.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      dealId: data.dealId ?? null,
      title: data.title,
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      location: data.location ?? null,
      source: "manual",
      createdById: ctx.userId,
    },
  });
  await recordEvent(ctx, { type: "meeting_created", leadId: lead.id, dealId: meeting.dealId, properties: { meetingId: meeting.id, scheduledAt: meeting.scheduledAt.toISOString(), source: "manual" } });
  // Booking a meeting moves the lead (and, through the lead, its deal) forward — never backward.
  if (ADVANCE_FROM.has(lead.status)) await changeLeadStatus(ctx, lead.id, "MEETING", "Meeting booked");
  return meeting;
}

export async function updateMeeting(ctx: TenantContext, id: string, input: z.input<typeof meetingUpdateSchema>) {
  assertCan(ctx, "crm:write");
  const data = meetingUpdateSchema.parse(input);
  const meeting = await ctx.db.meeting.findFirst({ where: { id } });
  if (!meeting) throw new NotFoundError("Meeting", id);
  return ctx.db.meeting.update({ where: { id }, data });
}

export async function listMeetings(ctx: TenantContext, input: z.input<typeof meetingListSchema> = {}) {
  assertCan(ctx, "crm:read");
  const query = meetingListSchema.parse(input);
  const now = new Date();
  // A meeting stays "upcoming" until it has ended and been marked, so today's meetings don't vanish at start time.
  const upcoming = { scheduledAt: { gte: new Date(now.getTime() - 3 * 3_600_000) }, status: "SCHEDULED" as const };
  const meetings = await ctx.db.meeting.findMany({
    where: { lead: { deletedAt: null }, ...(query.leadId ? { leadId: query.leadId } : {}), ...(query.when === "upcoming" ? upcoming : { NOT: upcoming }) },
    orderBy: { scheduledAt: query.when === "upcoming" ? "asc" : "desc" },
    take: query.limit,
    include: { lead: { select: { id: true, name: true, city: true } }, deal: { select: { id: true, title: true, stage: true } } },
  });
  return meetings;
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (match) => `\\${match}`);
}

/** Calendar invite (RFC 5545) so the meeting can be added to any calendar. */
export async function meetingIcs(ctx: TenantContext, id: string): Promise<{ fileName: string; body: string }> {
  assertCan(ctx, "crm:read");
  const meeting = await ctx.db.meeting.findFirst({ where: { id }, include: { lead: { select: { id: true, name: true } } } });
  if (!meeting) throw new NotFoundError("Meeting", id);
  const end = new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000);
  const url = `${getEnv().APP_URL}/app/leads/${meeting.lead.id}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reachly//CRM//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@reachai`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(meeting.scheduledAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(meeting.title)}`,
    `DESCRIPTION:${icsText(`Meeting with ${meeting.lead.name}\n${url}`)}`,
    ...(meeting.location ? [`LOCATION:${icsText(meeting.location)}`] : []),
    `STATUS:${meeting.status === "CANCELED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { fileName: `meeting-${meeting.scheduledAt.toISOString().slice(0, 10)}.ics`, body: `${lines.join("\r\n")}\r\n` };
}
