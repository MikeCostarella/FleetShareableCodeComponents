// Tests for the end-of-run sanity checks (Statehouse #10, #17).

import { describe, expect, it, vi } from "vitest";
import { bboxWithin, createReport, explain, mb, median, outsideBox, pinCoverage, strayPins } from "./report.mjs";

const FRANKLIN = { xmin: -83.2049, ymin: 39.8088, xmax: -82.7712, ymax: 40.1573 };

describe("median", () => {
  it("uses the upper median, matching medianAssessedRatio in parcelBuild.mjs", () => {
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([3, 1, 2])).toBe(2);
  });

  it("ignores non-numbers and returns null for an empty set", () => {
    expect(median([1, NaN, "x", 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe("pinCoverage", () => {
  it("counts placed pins without dividing by zero on an empty harvest", () => {
    expect(pinCoverage([{ lat: 1 }, { lat: 2 }, {}])).toEqual({ total: 3, withPin: 2, pct: 200 / 3 });
    expect(pinCoverage([])).toEqual({ total: 0, withPin: 0, pct: 0 });
  });
});

describe("strayPins — a stray is a projection failure, not a moved parcel", () => {
  it("counts pins outside the county envelope", () => {
    const records = [
      { lat: 39.96, lon: -83.0 }, // Columbus
      { lat: 41.49, lon: -81.69 }, // Cleveland — the wrong-zone signature
      { lat: null, lon: null }, // unplaced, not a stray
    ];
    expect(strayPins(records, FRANKLIN)).toBe(1);
  });

  it("is zero for a clean harvest", () => {
    expect(strayPins([{ lat: 39.96, lon: -83.0 }], FRANKLIN)).toBe(0);
  });

  it("a tolerance forgives the county line but not the wrong zone", () => {
    // Pleasant Township, Opossum Run Rd — a real Franklin parcel 0.03 deg
    // west of the box. Cleveland is the wrong-zone signature, ~1.5 deg north.
    const border = { lat: 39.822171, lon: -83.236126 };
    const wrongZone = { lat: 41.4993, lon: -81.6944 };
    const records = [border, wrongZone, { lat: 39.96, lon: -83.0 }];

    expect(strayPins(records, FRANKLIN)).toBe(2); // no tolerance: both flagged
    expect(strayPins(records, FRANKLIN, { tolerance: 0.06 })).toBe(1); // only the real fault
  });

  it("outsideBox reports how far the worst pin is, so a border case is legible", () => {
    const r = outsideBox([{ lat: 39.822171, lon: -83.236126 }], FRANKLIN);
    expect(r.count).toBe(1);
    expect(r.worst).toBeCloseTo(0.0312, 3);
  });

  it("defaults to no tolerance, preserving the original contract", () => {
    expect(outsideBox([{ lat: 39.96, lon: -83.0 }], FRANKLIN)).toEqual({ count: 0, worst: 0 });
  });
});

describe("bboxWithin", () => {
  it("checks a declared extent against the county envelope", () => {
    expect(bboxWithin({ xmin: -83.1, xmax: -82.8, ymin: 39.9, ymax: 40.1 }, FRANKLIN)).toBe(true);
    expect(bboxWithin({ xmin: -85, xmax: -82.8, ymin: 39.9, ymax: 40.1 }, FRANKLIN)).toBe(false);
  });
});

describe("explain", () => {
  it("surfaces the cause code that 'fetch failed' hides", () => {
    const e = Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    expect(explain(e)).toBe("fetch failed — ENOTFOUND");
    expect(explain(new Error("plain"))).toBe("plain");
  });
});

describe("createReport", () => {
  it("accumulates every line it prints and writes them as a file", () => {
    const echo = vi.fn();
    const write = vi.fn();
    const r = createReport("/tmp/inspect-report.txt", { echo, write });
    r.say("first");
    r.say();
    r.say("second");
    r.flush();
    expect(r.lines).toEqual(["first", "", "second"]);
    expect(write).toHaveBeenCalledWith("/tmp/inspect-report.txt", "first\n\nsecond\n", "utf8");
  });

  it("mb formats at one decimal by default", () => {
    expect(mb(466 * 1_048_576)).toBe("466.0 MB");
    expect(mb(1_048_576, 2)).toBe("1.00 MB");
  });
});
