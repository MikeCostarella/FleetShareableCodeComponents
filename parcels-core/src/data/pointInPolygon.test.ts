// Tests for the point-in-polygon geometry (Statehouse Sprint 1, issue #2).
//
// This is the class of code where a sign error once produced 129 pins out of
// 101,088 with no error message — geometry fails silently, so every behavior
// here is pinned with fixtures small enough to verify by hand on graph paper.

import { describe, expect, it } from "vitest";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { jurisdictionAt, pointInGeometry } from "./pointInPolygon";

/** Closed square ring from (x0,y0) to (x1,y1), counter-clockwise. */
function square(x0: number, y0: number, x1: number, y1: number): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

const plainSquare: Geometry = { type: "Polygon", coordinates: [square(0, 0, 10, 10)] };
const squareWithHole: Geometry = {
  type: "Polygon",
  coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)], // hole in the middle
};
const twoIslands: Geometry = {
  type: "MultiPolygon",
  coordinates: [[square(0, 0, 2, 2)], [square(10, 10, 12, 12)]],
};

describe("pointInGeometry", () => {
  it("detects inside vs outside a simple polygon", () => {
    expect(pointInGeometry(5, 5, plainSquare)).toBe(true);
    expect(pointInGeometry(11, 5, plainSquare)).toBe(false);
    expect(pointInGeometry(-1, -1, plainSquare)).toBe(false);
  });

  it("excludes points inside a hole, keeps points between hole and outer ring", () => {
    expect(pointInGeometry(5, 5, squareWithHole)).toBe(false); // in the hole
    expect(pointInGeometry(2, 2, squareWithHole)).toBe(true);  // between hole and outer
    expect(pointInGeometry(4.5, 2, squareWithHole)).toBe(true); // below the hole
  });

  it("finds points in any polygon of a MultiPolygon", () => {
    expect(pointInGeometry(1, 1, twoIslands)).toBe(true);   // first island
    expect(pointInGeometry(11, 11, twoIslands)).toBe(true); // second island
    expect(pointInGeometry(5, 5, twoIslands)).toBe(false);  // the water between
  });

  it("returns false for missing or non-areal geometry", () => {
    expect(pointInGeometry(5, 5, null)).toBe(false);
    expect(pointInGeometry(5, 5, undefined)).toBe(false);
    expect(pointInGeometry(5, 5, { type: "Point", coordinates: [5, 5] })).toBe(false);
    expect(pointInGeometry(5, 5, { type: "Polygon", coordinates: [] })).toBe(false); // no rings
  });

  it("boundary points follow ray-casting's half-open convention (documented, not designed)", () => {
    // Standard ray-casting: min-side edges count as inside, max-side as outside.
    // For jurisdiction labeling of real parcels this asymmetry is irrelevant —
    // a parcel point never sits exactly on a TIGER boundary vertex — but the
    // behavior is pinned here so a refactor that changes it does so knowingly.
    expect(pointInGeometry(0, 5, plainSquare)).toBe(true);   // left edge
    expect(pointInGeometry(5, 0, plainSquare)).toBe(true);   // bottom edge
    expect(pointInGeometry(10, 5, plainSquare)).toBe(false); // right edge
    expect(pointInGeometry(0, 0, plainSquare)).toBe(true);   // min corner
  });
});

// ---- jurisdictionAt --------------------------------------------------------

function fc(name: string, geom: Geometry): FeatureCollection {
  const feature: Feature = { type: "Feature", geometry: geom as never, properties: { NAME: name } };
  return { type: "FeatureCollection", features: [feature] };
}

const munis = fc("Columbus city", { type: "Polygon", coordinates: [square(0, 0, 10, 10)] });
const twps = fc("Franklin Twp", { type: "Polygon", coordinates: [square(0, 0, 20, 20)] });

describe("jurisdictionAt", () => {
  it("prefers municipality over township when both contain the point", () => {
    expect(jurisdictionAt(5, 5, munis, twps)).toBe("Columbus");
  });

  it("strips the source's type suffix and appends Township for townships", () => {
    // "Franklin Twp" must NOT become "Franklin Twp Township" — the county has
    // a township named after the city, which is why "Twp" is in the strip list.
    expect(jurisdictionAt(15, 15, munis, twps)).toBe("Franklin Township");
  });

  it("falls back through null collections", () => {
    expect(jurisdictionAt(15, 15, null, twps)).toBe("Franklin Township");
    expect(jurisdictionAt(5, 5, munis, null)).toBe("Columbus");
  });

  it("reports Outside mapped area when nothing contains the point", () => {
    expect(jurisdictionAt(30, 30, munis, twps)).toBe("Outside mapped area");
    expect(jurisdictionAt(5, 5, null, null)).toBe("Outside mapped area");
  });
});
