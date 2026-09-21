import { describe, expect, it } from "vitest";
import { currentBillingPeriod } from "./dates";

describe("currentBillingPeriod", () => {
  it("returns the monthly period containing now", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    const period = currentBillingPeriod(anchor, new Date("2026-03-20T00:00:00Z"));
    expect(period.start.toISOString()).toBe("2026-03-15T10:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-04-15T10:00:00.000Z");
  });

  it("handles now exactly at a boundary", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    const period = currentBillingPeriod(anchor, new Date("2026-02-15T10:00:00Z"));
    expect(period.start.toISOString()).toBe("2026-02-15T10:00:00.000Z");
  });

  it("keeps the anchor period when now is inside it", () => {
    const anchor = new Date("2026-01-15T10:00:00Z");
    expect(currentBillingPeriod(anchor, new Date("2026-01-20T00:00:00Z")).start).toEqual(anchor);
  });
});
