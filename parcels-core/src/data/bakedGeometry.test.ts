// Tests for the baked-file polygon source.
//
// These exist because the extraction they cover replaced twelve identical
// copies, and "Vinton still renders" is not evidence that the other eleven
// will. The cases below are the behaviours the copies actually had, pinned so
// a future edit to the shared version cannot quietly change them for everyone.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bakedGeometrySource } from "./bakedGeometry";
import type { Feature, MultiPolygon, Polygon } from "geojson";

interface Props {
  KEY: string | null;
}

/** A unit square with its lower-left corner at (x, y). */
function square(x: number, y: number, key: string, withBBox = true) {
  const f: Feature<Polygon | MultiPolygon, Props> & { bbox?: number[] } = {
    type: "Feature",
    properties: { KEY: key },
    geometry: {
      type: "Polygon",
      coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
    },
  };
  if (withBBox) f.bbox = [x, y, x + 1, y + 1];
  return f;
}

function mockFetch(features: unknown[], ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => ({ type: "FeatureCollection", features }),
  });
}

const ALL_OF_IT = { west: -1e6, south: -1e6, east: 1e6, north: 1e6 };

describe("bakedGeometrySource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch([]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns only features whose bbox intersects the viewport", async () => {
    vi.stubGlobal("fetch", mockFetch([square(0, 0, "a"), square(10, 10, "b")]));
    const source = bakedGeometrySource<Props>();
    const fc = await source({ west: -0.5, south: -0.5, east: 0.5, north: 0.5 });
    expect(fc.features.map((f) => f.properties.KEY)).toEqual(["a"]);
  });

  it("treats an edge-touching bbox as a hit, not a miss", async () => {
    // The copies used `e < west || w > east`, so touching counts. Pinned
    // because flipping either to <= silently drops boundary parcels.
    vi.stubGlobal("fetch", mockFetch([square(0, 0, "a")]));
    const source = bakedGeometrySource<Props>();
    const fc = await source({ west: 1, south: 0, east: 2, north: 1 });
    expect(fc.features).toHaveLength(1);
  });

  it("computes a bbox when the baked file has none", async () => {
    vi.stubGlobal("fetch", mockFetch([square(0, 0, "a", false)]));
    const source = bakedGeometrySource<Props>();
    const hit = await source({ west: -0.5, south: -0.5, east: 0.5, north: 0.5 });
    const miss = await source({ west: 50, south: 50, east: 51, north: 51 });
    expect(hit.features).toHaveLength(1);
    expect(miss.features).toHaveLength(0);
  });

  it("stops at maxFeatures", async () => {
    const many = Array.from({ length: 20 }, (_, i) => square(i * 0.01, 0, `k${i}`));
    vi.stubGlobal("fetch", mockFetch(many));
    const source = bakedGeometrySource<Props>({ maxFeatures: 5 });
    const fc = await source(ALL_OF_IT);
    expect(fc.features).toHaveLength(5);
  });

  it("fetches the file once however many viewports are requested", async () => {
    const f = mockFetch([square(0, 0, "a")]);
    vi.stubGlobal("fetch", f);
    const source = bakedGeometrySource<Props>();
    await source(ALL_OF_IT);
    await source(ALL_OF_IT);
    await source({ west: 5, south: 5, east: 6, north: 6 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does not fetch until the first viewport is requested", async () => {
    const f = mockFetch([]);
    vi.stubGlobal("fetch", f);
    bakedGeometrySource<Props>();
    expect(f).not.toHaveBeenCalled();
  });

  it("retries after a failed load rather than caching the failure", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        json: async () => ({ type: "FeatureCollection", features: [square(0, 0, "a")] }),
      });
    vi.stubGlobal("fetch", failing);
    const source = bakedGeometrySource<Props>();
    await expect(source(ALL_OF_IT)).rejects.toThrow("network");
    const fc = await source(ALL_OF_IT);
    expect(fc.features).toHaveLength(1);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch([], false));
    const source = bakedGeometrySource<Props>();
    await expect(source(ALL_OF_IT)).rejects.toThrow(/500/);
  });

  it("gives each source its own cache", async () => {
    const f = mockFetch([square(0, 0, "a")]);
    vi.stubGlobal("fetch", f);
    await bakedGeometrySource<Props>({ file: "one.json" })(ALL_OF_IT);
    await bakedGeometrySource<Props>({ file: "two.json" })(ALL_OF_IT);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[0][0])).toContain("one.json");
    expect(String(f.mock.calls[1][0])).toContain("two.json");
  });
});
