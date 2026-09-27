// Tests for the parcel data loader (Statehouse Sprint 1, issue #3).
//
// loadPoints detects its input shape by structure: a plain array (most
// counties) or a chunk manifest (Franklin — GitHub refuses files over 100 MB,
// so parcels.json names the chunk files instead of holding the data). A wrong
// guess loads nothing, and a half-loaded county must fail loudly, not render
// a plausible-looking partial map. All fetches are mocked; no network.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawParcel } from "../types/point";
import { jurisdictionCounts, loadPoints, taxingDistrictCounts, typeCounts } from "./loadPoints";

/** Route fetches by URL suffix; anything unrouted is a test bug. */
function mockFetch(routes: Record<string, { status?: number; statusText?: string; body: string }>) {
  const fn = vi.fn(async (url: unknown) => {
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    if (!key) throw new Error(`unexpected fetch: ${String(url)}`);
    const r = routes[key];
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: r.statusText ?? "OK",
      text: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

/** A raw record with a coordinate, an approx flag, and an auditor id. */
const rawA: RawParcel = {
  n: "010-000001-00", o: "OWNER A", d: "LOT 1", u: "510", j: "Columbus",
  a: 0.25, lm: 40000, bm: 160000, tm: 200000, ta: 70000,
  s: "2021-06-15", f: "1 OAK ST", z: "43215", y: 39.96, x: -83.0, c: 1, p: 42,
};
/** A raw record with no coordinate, a township, and no auditor id. */
const rawB: RawParcel = {
  n: "010-000002-00", o: "OWNER B", d: "LOT 2", u: "110", j: "Dublin",
  tw: "Washington Township",
  a: 40, lm: 90000, bm: 0, tm: 90000, ta: 31500,
  s: "", f: "", z: "43017",
};

describe("loadPoints — plain array shape", () => {
  it("expands raw short-key records into full Parcels", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([rawA, rawB]) } });
    const points = await loadPoints();
    expect(points).toHaveLength(2);

    const a = points[0];
    expect(a.parcelNumber).toBe("010-000001-00");
    expect(a.type).toBe(5);              // major class from land-use "510"
    expect(a.hasCoord).toBe(true);
    expect(a.approxCoord).toBe(true);    // c: 1
    expect(a.lat).toBe(39.96);
    expect(a.auditorId).toBe("42");   // stringified: one concept, one type
    expect(a.township).toBe("");         // no tw key

    const b = points[1];
    expect(b.type).toBe(1);
    expect(b.hasCoord).toBe(false);
    expect(b.approxCoord).toBe(false);
    expect(b.lat).toBe(0);
    expect(b.lon).toBe(0);
    expect(b.auditorId).toBeUndefined();  // p missing -> undefined, not 0
    expect(b.township).toBe("Washington Township");
    expect(b.taxingDistrict).toBe("");   // county publishes none -> ""
  });
});

describe("loadPoints — chunk manifest shape", () => {
  it("fetches every chunk and concatenates them in manifest order", async () => {
    const fn = mockFetch({
      "data/parcels.json": { body: JSON.stringify({ chunks: ["parcels-1.json", "parcels-2.json"], count: 2 }) },
      "data/parcels-1.json": { body: JSON.stringify([rawA]) },
      "data/parcels-2.json": { body: JSON.stringify([rawB]) },
    });
    const points = await loadPoints();
    expect(points).toHaveLength(2);
    expect(points[0].parcelNumber).toBe("010-000001-00"); // chunk order preserved
    expect(points[1].parcelNumber).toBe("010-000002-00");
    expect(fn).toHaveBeenCalledTimes(3); // manifest + both chunks
  });

  it("fails loudly when the chunks hold fewer parcels than the manifest promises", async () => {
    mockFetch({
      "data/parcels.json": { body: JSON.stringify({ chunks: ["parcels-1.json"], count: 493437 }) },
      "data/parcels-1.json": { body: JSON.stringify([rawA]) },
    });
    await expect(loadPoints()).rejects.toThrow(/incomplete.*493,437.*Re-run the build/s);
  });

  it("fails when a chunk is not an array", async () => {
    mockFetch({
      "data/parcels.json": { body: JSON.stringify({ chunks: ["parcels-1.json"] }) },
      "data/parcels-1.json": { body: JSON.stringify({ oops: true }) },
    });
    await expect(loadPoints()).rejects.toThrow("Parcel chunk parcels-1.json did not contain an array.");
  });
});

describe("loadPoints — clear error messages", () => {
  it("names the file and the fix on a 404", async () => {
    mockFetch({ "data/parcels.json": { status: 404, statusText: "Not Found", body: "" } });
    await expect(loadPoints()).rejects.toThrow(
      "Parcel data is missing (public/data/parcels.json). Run the build script.",
    );
  });

  it("reports other HTTP errors with status and file", async () => {
    mockFetch({ "data/parcels.json": { status: 500, statusText: "Server Error", body: "" } });
    await expect(loadPoints()).rejects.toThrow(/500 Server Error.*parcels\.json/);
  });

  it("detects the dev-server trap: an HTML page served instead of JSON", async () => {
    // A dev server answers a missing file with index.html and a 200 — parsing
    // that as JSON says "Unexpected token '<'", which explains nothing.
    mockFetch({ "data/parcels.json": { body: "<!doctype html><html></html>" } });
    await expect(loadPoints()).rejects.toThrow(/returned a web page instead of/);
  });

  it("reports corrupt JSON as corrupt, not as a parser stack trace", async () => {
    mockFetch({ "data/parcels.json": { body: '{"chunks": [truncated' } });
    await expect(loadPoints()).rejects.toThrow("Parcel data is not valid JSON (public/data/parcels.json is corrupt).");
  });

  it("rejects a payload that is neither array nor manifest", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify({ rows: [] }) } });
    await expect(loadPoints()).rejects.toThrow("parcels.json is neither an array nor a chunk manifest.");
  });
});

describe("taxing district (published by some counties, not others)", () => {
  it("carries the district through when the county publishes one", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([{ ...rawA, td: "COLUMBUS CSD 025" }]) } });
    const points = await loadPoints();
    expect(points[0].taxingDistrict).toBe("COLUMBUS CSD 025");
  });

  it("defaults to empty when the county does not, so counts fall in one bucket", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([rawA, rawB]) } });
    const points = await loadPoints();
    expect(points.every((p) => p.taxingDistrict === "")).toBe(true);
    expect(taxingDistrictCounts(points)).toEqual([{ name: "Unassigned", count: 2 }]);
  });

  it("sorts districts alphabetically with Unassigned last", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([
      { ...rawA, n: "1", td: "ZANE TWP" }, { ...rawA, n: "2", td: "ADAMS CSD" }, { ...rawA, n: "3" },
    ]) } });
    const points = await loadPoints();
    expect(taxingDistrictCounts(points).map((d) => d.name)).toEqual(["ADAMS CSD", "ZANE TWP", "Unassigned"]);
  });
});

describe("count helpers", () => {
  it("jurisdictionCounts sorts by count descending", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([rawA, rawB, { ...rawB, n: "010-3" }]) } });
    const points = await loadPoints();
    expect(jurisdictionCounts(points)).toEqual([
      { name: "Dublin", count: 2 },
      { name: "Columbus", count: 1 },
    ]);
  });

  it("typeCounts keys by major class", async () => {
    mockFetch({ "data/parcels.json": { body: JSON.stringify([rawA, rawB, { ...rawB, n: "010-3" }]) } });
    const points = await loadPoints();
    const counts = typeCounts(points);
    expect(counts.get(5)).toBe(1);
    expect(counts.get(1)).toBe(2);
  });
});
