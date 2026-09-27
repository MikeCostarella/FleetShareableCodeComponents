// Tests for the winding-independent pin math (Statehouse Sprint 1, issue #6).
// The bug being guarded: encoding Esri's ring-winding convention with the
// sign backwards classified every outer ring as a hole and produced 129 pins
// out of 101,088 — with no error. The fix (and the contract here): the pin
// goes on the ring with the largest ABSOLUTE area, whichever way it winds.

import { describe, expect, it } from "vitest";
import {
  SAME_PLACE,
  largestRing,
  reduceRings,
  reduceRingsMeasured,
  ringCentroid,
  samePlace,
  signedArea,
} from "./geometry.mjs";

/** Closed square ring, counter-clockwise. */
const ccwSquare = (x0, y0, size) => [
  [x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0],
];
/** The same square wound clockwise. */
const cwSquare = (x0, y0, size) => ccwSquare(x0, y0, size).slice().reverse();

describe("ringCentroid", () => {
  it("finds the center of a square", () => {
    const [cx, cy] = ringCentroid(ccwSquare(0, 0, 10));
    expect(cx).toBeCloseTo(5, 10);
    expect(cy).toBeCloseTo(5, 10);
  });

  it("is winding-independent", () => {
    const [ax, ay] = ringCentroid(ccwSquare(2, 4, 6));
    const [bx, by] = ringCentroid(cwSquare(2, 4, 6));
    expect(ax).toBeCloseTo(bx, 10);
    expect(ay).toBeCloseTo(by, 10);
  });

  it("falls back to the vertex mean for a zero-area ring", () => {
    const degenerate = [[0, 0], [10, 0], [0, 0]]; // a spike, no area
    const [cx, cy] = ringCentroid(degenerate);
    expect(cx).toBeCloseTo(10 / 3, 10);
    expect(cy).toBeCloseTo(0, 10);
  });
});

describe("reduceRings — the 129-pins contract", () => {
  const outer = ccwSquare(0, 0, 100); // area 10,000
  const hole = ccwSquare(40, 40, 10); // area 100

  it("pins the largest ring regardless of ring order", () => {
    const a = reduceRings([outer, hole]);
    const b = reduceRings([hole, outer]);
    expect(a.lon).toBeCloseTo(50, 8);
    expect(a.lat).toBeCloseTo(50, 8);
    expect(b.lon).toBeCloseTo(a.lon, 10);
    expect(b.lat).toBeCloseTo(a.lat, 10);
  });

  it("pins the same spot whichever way the rings wind — the exact failure mode of the 129-pins bug", () => {
    // With sign-dependent logic, flipping the winding reclassifies outer
    // rings as holes. With |area| logic these four calls must all agree.
    const variants = [
      [ccwSquare(0, 0, 100), ccwSquare(40, 40, 10)],
      [cwSquare(0, 0, 100), ccwSquare(40, 40, 10)],
      [ccwSquare(0, 0, 100), cwSquare(40, 40, 10)],
      [cwSquare(0, 0, 100), cwSquare(40, 40, 10)],
    ];
    for (const rings of variants) {
      const pin = reduceRings(rings);
      expect(pin.lon).toBeCloseTo(50, 8);
      expect(pin.lat).toBeCloseTo(50, 8);
    }
  });

  it("skips degenerate rings and returns null when nothing usable remains", () => {
    expect(reduceRings([[[0, 0], [1, 1]]])).toBeNull(); // fewer than 3 points
    expect(reduceRings([])).toBeNull();
    expect(reduceRings([null])).toBeNull();
  });

  it("a multipart parcel pins on its largest piece", () => {
    const mainLot = ccwSquare(0, 0, 50);     // area 2,500
    const slivers = ccwSquare(200, 200, 5);  // area 25
    const pin = reduceRings([slivers, mainLot]);
    expect(pin.lon).toBeCloseTo(25, 8);
    expect(pin.lat).toBeCloseTo(25, 8);
  });
});

/* ---- added for Statehouse issue #10: the measured reduction ------------- */

describe("signedArea + largestRing", () => {
  it("signs by winding but measures the same magnitude either way", () => {
    expect(signedArea(ccwSquare(0, 0, 10))).toBeCloseTo(100, 10);
    expect(signedArea(cwSquare(0, 0, 10))).toBeCloseTo(-100, 10);
  });

  it("largestRing returns the biggest absolute ring and its area", () => {
    const r = largestRing([ccwSquare(0, 0, 5), cwSquare(100, 100, 20)]);
    expect(r.area).toBeCloseTo(400, 8);
    expect(largestRing([])).toBeNull();
  });
});

describe("reduceRingsMeasured", () => {
  it("selects the ring and takes the centroid in the SAME metric", () => {
    // Anisotropic projection: x doubled, y unchanged. Three counties selected
    // in feet and centroided in degrees, so the pin and the area disagreed.
    const project = ([x, y]) => [x * 2, y];
    const unproject = ([x, y]) => [x / 2, y];
    const g = reduceRingsMeasured([ccwSquare(0, 0, 10)], { project, unproject, sqftPerAcre: 1 });
    expect(g.lon).toBeCloseTo(5, 6);
    expect(g.lat).toBeCloseTo(5, 6);
    expect(g.sqft).toBeCloseTo(200, 6); // measured in the projected metric
  });

  it("subtracts holes from the total area but keeps the pin on the outer ring", () => {
    // Esri winds holes the other way, so the signed sum removes them.
    const g = reduceRingsMeasured([ccwSquare(0, 0, 100), cwSquare(40, 40, 10)], { sqftPerAcre: 1 });
    expect(g.sqft).toBeCloseTo(9900, 6);
    expect(g.lon).toBeCloseTo(50, 6);
  });

  it("converts to acres and survives a parcel with no usable ring", () => {
    const g = reduceRingsMeasured([ccwSquare(0, 0, Math.sqrt(43_560))]);
    expect(g.acres).toBeCloseTo(1, 4);
    expect(reduceRingsMeasured([])).toBeNull();
  });

  it("pins a multipart parcel on its largest piece, not between the pieces", () => {
    // Knox and Morrow summed every ring into one accumulator and returned a
    // point in the void between two disjoint parts.
    const g = reduceRingsMeasured([ccwSquare(0, 0, 50), ccwSquare(1000, 1000, 5)]);
    expect(g.lon).toBeCloseTo(25, 4);
    expect(g.lat).toBeCloseTo(25, 4);
  });
});

describe("samePlace — the duplicate-outline threshold", () => {
  it("is coarser than the geometryPrecision=6 the harvest itself requests", () => {
    // Montgomery used 1e-6 (~10 cm) while asking for ~11 cm precision, so
    // rounding jitter read as a second piece and its acreage was ADDED.
    expect(SAME_PLACE).toBe(1e-5);
    const a = { lat: 39.75, lon: -84.19 };
    const jittered = { lat: 39.750002, lon: -84.190003 };
    expect(samePlace(a, jittered)).toBe(true);
    expect(samePlace(a, { lat: 39.76, lon: -84.19 })).toBe(false);
  });
});
