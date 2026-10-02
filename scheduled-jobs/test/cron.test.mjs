import { describe, expect, it } from "vitest";
import { describeCron, nextRuns, ordinal, parseCron } from "../src/cron.mjs";

const TZ = "America/New_York";
const iso = (d) => d.toISOString().slice(0, 16);
const OCT = new Date("2026-10-02T14:25:00Z");

describe("parseCron", () => {
  it("parses the fleet's real schedules", () => {
    for (const e of ["17 7 * * *", "23 9 6 * *", "41 11 * * *", "0 7 * * 1", "0 12 8 * *", "0 12 21 * *", "23 6 * * *", "17 13 3-14 1 *"]) {
      expect(() => parseCron(e)).not.toThrow();
    }
  });
  it("rejects malformed expressions", () => {
    for (const e of ["0 12 * *", "60 * * * *", "0 25 * * *", "0 0 0 * *"]) expect(() => parseCron(e)).toThrow();
  });
  it("ranges, steps, lists, names", () => {
    const c = parseCron("*/15 9-17/4 1,15 JAN-MAR MON-FRI");
    expect([...c.minute]).toEqual([0, 15, 30, 45]);
    expect([...c.hour]).toEqual([9, 13, 17]);
    expect([...c.dom]).toEqual([1, 15]);
    expect([...c.month]).toEqual([1, 2, 3]);
    expect([...c.dow]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 0 * * 7").dow]).toEqual([0]);
  });
});

describe("nextRuns", () => {
  it("daily, monthly, weekly", () => {
    expect(iso(nextRuns("17 7 * * *", OCT)[0])).toBe("2026-10-03T07:17");
    expect(iso(nextRuns("41 14 * * *", OCT)[0])).toBe("2026-10-02T14:41");
    expect(nextRuns("0 12 8,21 * *", OCT, 3).map(iso)).toEqual(["2026-10-08T12:00", "2026-10-21T12:00", "2026-11-08T12:00"]);
    expect(iso(nextRuns("0 7 * * 1", OCT)[0])).toBe("2026-10-05T07:00");
  });
  it("skips short months, treats dom+dow as either, is strictly after `from`", () => {
    expect(iso(nextRuns("0 0 31 * *", new Date("2026-09-01T00:00:00Z"))[0])).toBe("2026-10-31T00:00");
    expect(iso(nextRuns("0 0 1 * 5", new Date("2026-09-30T12:00:00Z"))[0])).toBe("2026-10-01T00:00");
    expect(iso(nextRuns("0 12 8 * *", new Date("2026-10-08T12:00:00Z"))[0])).toBe("2026-11-08T12:00");
  });
});

describe("describeCron", () => {
  it("plain words in Eastern time, DST-aware", () => {
    expect(describeCron("17 7 * * *", TZ, OCT).text).toBe("daily at 3:17 AM");
    expect(describeCron("0 12 8 * *", TZ, OCT).text).toBe("monthly on the 8th at 8:00 AM");
    expect(describeCron("0 7 * * 1", TZ, OCT).text).toBe("Mondays at 3:00 AM");
    expect(describeCron("0 12 8 * *", TZ, OCT).utc).toBe("12:00 UTC");
    expect(describeCron("17 7 * * *", TZ, new Date("2026-12-01T00:00:00Z")).text).toBe("daily at 2:17 AM");
  });
  it("flags a local day shift", () => {
    const d = describeCron("0 2 8 * *", TZ, new Date("2026-10-02T00:00:00Z"));
    expect(d.dayShift).toBe(true);
    expect(d.text).toMatch(/evening before/);
  });
  it("frequent schedules and weekday sets", () => {
    expect(describeCron("5 * * * *", TZ).text).toBe("hourly at :05");
    expect(describeCron("*/15 * * * *", TZ).text).toBe("every 15 minutes");
    expect(describeCron("0 9 * * 1-5", TZ, new Date("2026-10-02T00:00:00Z")).text).toBe("weekdays at 5:00 AM");
  });
  it("collapses day ranges; a one-month schedule drops 'monthly'", () => {
    const at = new Date("2026-10-02T17:00:00Z");
    expect(describeCron("17 13 3-14 1 *", TZ, at).text).toBe("on the 3rd–14th in Jan at 8:17 AM");
    expect(describeCron("0 12 8,21 * *", TZ, at).text).toBe("monthly on the 8th and 21st at 8:00 AM");
    expect(describeCron("0 12 1,2,3,10 * *", TZ, at).text).toBe("monthly on the 1st–3rd and 10th at 8:00 AM");
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});
