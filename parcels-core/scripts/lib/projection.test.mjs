// Tests for the Ohio State Plane zones (Statehouse #10).
// The zone is the most dangerous constant in the fleet: the wrong one does not
// throw, it just puts every parcel several miles from where it belongs.

import { describe, expect, it } from "vitest";
import proj4 from "proj4";
import { OHIO_NORTH, OHIO_SOUTH, SQFT_PER_ACRE, makeStatePlane, sqftToAcres, zoneDef } from "./projection.mjs";

describe("zoneDef", () => {
  it("resolves by name and by EPSG code", () => {
    expect(zoneDef("south").epsg).toBe("EPSG:3735");
    expect(zoneDef("North").epsg).toBe("EPSG:3734");
    expect(zoneDef("EPSG:3734").def).toBe(OHIO_NORTH);
    expect(zoneDef(3735).def).toBe(OHIO_SOUTH);
  });

  it("refuses an unknown zone loudly rather than defaulting to one", () => {
    expect(() => zoneDef("central")).toThrow(/north.*south/i);
  });

  it("both definitions carry the false easting in metres, as PROJ expects", () => {
    // 600,000 m is exactly the 1,968,500 ftUS the EPSG definition specifies.
    expect(OHIO_NORTH).toContain("+x_0=600000");
    expect(OHIO_SOUTH).toContain("+x_0=600000");
    expect(OHIO_NORTH).toContain("+units=us-ft");
    expect(OHIO_SOUTH).toContain("+units=us-ft");
  });
});

describe("makeStatePlane — the verified round trips", () => {
  it("puts Franklin's extreme SOUTH-zone coordinate on the county's north-east corner", () => {
    // The value the harvest comment records: X_COORD 1,892,494 / Y_COORD
    // 780,120 projects to 40.1415 N, -82.7718 W.
    const sp = makeStatePlane(proj4, "south");
    const [lon, lat] = sp.toWgs84([1_892_494, 780_120]);
    expect(lat).toBeCloseTo(40.1415, 3);
    expect(lon).toBeCloseTo(-82.7718, 3);
  });

  it("round-trips degrees -> feet -> degrees", () => {
    const sp = makeStatePlane(proj4, "north");
    const start = [-81.6944, 41.4993]; // downtown Cleveland
    const [lon, lat] = sp.toWgs84(sp.fromWgs84(start));
    expect(lon).toBeCloseTo(start[0], 6);
    expect(lat).toBeCloseTo(start[1], 6);
  });

  it("the wrong zone does not throw — it silently moves the parcel miles", () => {
    const north = makeStatePlane(proj4, "north");
    const south = makeStatePlane(proj4, "south");
    const [lonN, latN] = north.toWgs84([1_892_494, 780_120]);
    const [lonS, latS] = south.toWgs84([1_892_494, 780_120]);
    expect(Number.isFinite(latN)).toBe(true); // no error, which is the danger
    const milesApart = Math.hypot((lonN - lonS) * 53, (latN - latS) * 69);
    expect(milesApart).toBeGreaterThan(10);
  });
});

describe("area units", () => {
  it("converts square feet to acres", () => {
    expect(SQFT_PER_ACRE).toBe(43_560);
    expect(sqftToAcres(43_560)).toBe(1);
    expect(sqftToAcres(169.884)).toBeCloseTo(0.0039, 4); // the Greene sliver
  });
});
