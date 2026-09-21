import { describe, expect, it } from "vitest";
import { localParts, nextSendWindow, quietHoursSchema, withinSendWindow } from "./policy";

const IST = "Asia/Kolkata";
const WEEKDAYS_9_TO_7 = quietHoursSchema.parse({});

describe("send window", () => {
  it("reads local weekday and hour in the workspace timezone", () => {
    // Monday 2026-09-21 05:00 UTC = 10:30 IST
    expect(localParts(new Date("2026-09-21T05:00:00Z"), IST)).toEqual({ weekday: 1, hour: 10, minute: 30 });
  });

  it("allows weekday business hours and blocks evenings and weekends", () => {
    expect(withinSendWindow(new Date("2026-09-21T05:00:00Z"), IST, WEEKDAYS_9_TO_7)).toBe(true);
    expect(withinSendWindow(new Date("2026-09-21T14:00:00Z"), IST, WEEKDAYS_9_TO_7)).toBe(false); // 19:30 IST
    expect(withinSendWindow(new Date("2026-09-26T05:00:00Z"), IST, WEEKDAYS_9_TO_7)).toBe(false); // Saturday
  });

  it("returns the same instant when already inside the window", () => {
    const at = new Date("2026-09-22T06:10:00Z");
    expect(nextSendWindow(at, IST, WEEKDAYS_9_TO_7)).toEqual(at);
  });

  it("defers evening sends to 09:00 local the next working day", () => {
    const next = nextSendWindow(new Date("2026-09-21T14:00:00Z"), IST, WEEKDAYS_9_TO_7);
    expect(next.toISOString()).toBe("2026-09-22T03:30:00.000Z"); // Tue 09:00 IST
  });

  it("skips the weekend", () => {
    const next = nextSendWindow(new Date("2026-09-26T05:00:00Z"), IST, WEEKDAYS_9_TO_7);
    expect(next.toISOString()).toBe("2026-09-28T03:30:00.000Z"); // Mon 09:00 IST
  });
});
