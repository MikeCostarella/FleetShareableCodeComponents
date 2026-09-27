// Tests for the shared ArcGIS client and paging helpers (Statehouse #10).
// Every case here is a failure this fleet actually shipped: the HTML-in-a-200,
// the error-in-a-200, the hang with no timeout, the page that came back short
// and took 1,196 parcels with it.

import { describe, expect, it, vi } from "vitest";
import {
  chunk,
  fetchByIds,
  looksLikeDegrees,
  looksLikeHtml,
  makeArcgisClient,
  missingIds,
  pageAll,
  pick,
  probeOffsetHonored,
  reconcileIdsAndCount,
  resolveOidField,
  spreadSample,
} from "./arcgis.mjs";

const ok = (payload) => ({ text: async () => JSON.stringify(payload), status: 200 });
const raw = (text, status = 200) => ({ text: async () => text, status });

describe("makeArcgisClient", () => {
  it("POSTs and injects f=json — an over-long GET comes back as a 404 HTML page", async () => {
    const fetchImpl = vi.fn(async () => ok({ count: 7 }));
    const ask = makeArcgisClient({ fetchImpl });
    await ask("https://x/MapServer/0", { where: "1=1", returnCountOnly: "true" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x/MapServer/0/query");
    expect(init.method).toBe("POST");
    expect(init.body.get("f")).toBe("json");
    expect(init.body.get("where")).toBe("1=1");
  });

  it("raises on HTML in a 200 rather than dying inside JSON.parse", async () => {
    const ask = makeArcgisClient({
      fetchImpl: async () => raw("<!DOCTYPE html><html>404 not found</html>"),
      retries: 0,
    });
    await expect(ask("https://x", {})).rejects.toThrow(/HTML, not JSON/);
  });

  it("raises on an error body served with HTTP 200 — res.ok is not a guard", async () => {
    const ask = makeArcgisClient({
      fetchImpl: async () => ok({ error: { code: 400, message: "Invalid field: LSAD" } }),
      retries: 0,
    });
    await expect(ask("https://x", {})).rejects.toThrow(/service error 400: Invalid field: LSAD/);
  });

  it("retries with backoff and then succeeds", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => {});
    const ask = makeArcgisClient({
      fetchImpl: async () => {
        if (++calls < 3) throw new Error("fetch failed");
        return ok({ count: 1 });
      },
      sleep,
      retries: 4,
    });
    await expect(ask("https://x", {})).resolves.toEqual({ count: 1 });
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after retries+1 attempts and rethrows the last error", async () => {
    let calls = 0;
    const ask = makeArcgisClient({
      fetchImpl: async () => {
        calls++;
        throw new Error("ECONNRESET");
      },
      sleep: async () => {},
      retries: 2,
    });
    await expect(ask("https://x", {})).rejects.toThrow("ECONNRESET");
    expect(calls).toBe(3);
  });

  it("sets an abort signal — Cuyahoga, Delaware and Franklin shipped without one and could hang forever", async () => {
    const fetchImpl = vi.fn(async () => ok({}));
    await makeArcgisClient({ fetchImpl, timeoutMs: 1234 })("https://x", {});
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("pick", () => {
  it("copies requested fields, nulls the missing ones, drops the helpers", () => {
    const rec = pick({ A: 1, B: "x", X_COORD: 5 }, ["A", "B", "C", "X_COORD"], { drop: ["X_COORD"] });
    expect(rec).toEqual({ A: 1, B: "x", C: null });
  });
});

describe("spreadSample — Delaware's rural-corner bug", () => {
  it("spreads across the whole id range instead of taking a prefix", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    const picked = spreadSample(ids, 10);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe(1);
    expect(picked.at(-1)).toBeGreaterThan(900);
  });

  it("returns everything when the sample is bigger than the population", () => {
    expect(spreadSample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe("missingIds + reconcileIdsAndCount", () => {
  it("diffs the authoritative id list against what is on disk", () => {
    expect(missingIds([1, 2, 3, 4], new Set([2, 4]))).toEqual([1, 3]);
  });

  it("says which way the difference runs — Franklin's Math.abs asserted a direction it never checked", () => {
    expect(reconcileIdsAndCount(100, 100)).toBeNull();
    expect(reconcileIdsAndCount(102_284, 101_088)).toMatch(/1,196 more ids/);
    expect(reconcileIdsAndCount(99_892, 101_088)).toMatch(/1,196 fewer ids/);
  });
});

describe("resolveOidField", () => {
  it("prefers the declared field, then the OID type, then OBJECTID", () => {
    expect(resolveOidField({ objectIdField: "objectid" })).toBe("objectid");
    expect(resolveOidField({}, [{ name: "FID", type: "esriFieldTypeOID" }])).toBe("FID");
    expect(resolveOidField({}, [{ name: "NAME", type: "esriFieldTypeString" }])).toBe("OBJECTID");
  });
});

describe("pageAll", () => {
  const service = (pages) => async (_base, params) => {
    const offset = Number(params.resultOffset);
    return pages[offset] ?? { features: [] };
  };

  it("advances by what actually arrived, not by the page constant", async () => {
    // Page at offset 0 comes back SHORT (2 of 3). The lineage-B loop advanced
    // by PAGE and would have started the next request at 3, skipping row 2.
    const seen = [];
    const asked = [];
    const ask = async (base, params) => {
      asked.push(Number(params.resultOffset));
      const offset = Number(params.resultOffset);
      if (offset === 0) return { features: [{ id: 0 }, { id: 1 }] };
      if (offset === 2) return { features: [{ id: 2 }, { id: 3 }, { id: 4 }] };
      return { features: [] };
    };
    await pageAll({ ask, base: "b", total: 5, page: 3, onFeatures: (f) => seen.push(...f) });
    expect(asked).toEqual([0, 2]);
    expect(seen.map((f) => f.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it("reports a short page rather than stopping silently", async () => {
    const short = vi.fn();
    await pageAll({
      ask: service({ 0: { features: [{ id: 0 }] } }),
      base: "b",
      total: 10,
      page: 5,
      onFeatures: () => {},
      onShortPage: short,
    });
    expect(short).toHaveBeenCalled();
  });

  it("does not flag a short page the service says was truncated", async () => {
    const short = vi.fn();
    await pageAll({
      ask: async () => ({ features: [{ id: 0 }], exceededTransferLimit: true }),
      base: "b",
      total: 1,
      page: 5,
      onFeatures: () => {},
      onShortPage: short,
    });
    expect(short).not.toHaveBeenCalled();
  });

  it("resumes from a start offset", async () => {
    const asked = [];
    await pageAll({
      ask: async (_b, p) => {
        asked.push(Number(p.resultOffset));
        return { features: [] };
      },
      base: "b",
      total: 100,
      page: 10,
      startOffset: 40,
      onFeatures: () => {},
    });
    expect(asked).toEqual([40]);
  });

  it("always sorts — paging without a stable sort can return a row twice and another never", async () => {
    const ask = vi.fn(async () => ({ features: [] }));
    await pageAll({ ask, base: "b", total: 1, page: 1, onFeatures: () => {} });
    expect(ask.mock.calls[0][1].orderByFields).toBe("OBJECTID");
  });
});

describe("probeOffsetHonored", () => {
  it("catches a service that returns page 1 forever", async () => {
    const ask = async () => ({ features: [{ attributes: { PARCEL_NO: "SAME" } }] });
    expect((await probeOffsetHonored({ ask, base: "b", keyField: "PARCEL_NO" })).honored).toBe(false);
  });

  it("passes a service that honours the offset", async () => {
    const ask = async (_b, p) => ({
      features: [{ attributes: { PARCEL_NO: `row-${p.resultOffset}` } }],
    });
    expect((await probeOffsetHonored({ ask, base: "b", keyField: "PARCEL_NO" })).honored).toBe(true);
  });
});

describe("fetchByIds", () => {
  it("batches the id list and folds every page", async () => {
    const batches = [];
    const seen = [];
    await fetchByIds({
      ask: async (_b, p) => {
        batches.push(p.objectIds);
        return { features: p.objectIds.split(",").map((id) => ({ id })) };
      },
      base: "b",
      ids: [1, 2, 3, 4, 5],
      batch: 2,
      onFeatures: (f) => seen.push(...f),
    });
    expect(batches).toEqual(["1,2", "3,4", "5"]);
    expect(seen).toHaveLength(5);
  });
});

describe("small predicates", () => {
  it("looksLikeHtml", () => {
    expect(looksLikeHtml("  <!DOCTYPE html>")).toBe(true);
    expect(looksLikeHtml('{"count":1}')).toBe(false);
  });

  it("looksLikeDegrees separates lon/lat from State Plane feet", () => {
    expect(looksLikeDegrees([-82.77, 40.14])).toBe(true);
    expect(looksLikeDegrees([1_892_494, 780_120])).toBe(false);
    expect(looksLikeDegrees([])).toBe(false);
  });

  it("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("pageAll — short-page reporting", () => {
  it("names the offset the page was REQUESTED at, not the advanced one", async () => {
    const seen = [];
    await pageAll({
      ask: async (_b, p) => (Number(p.resultOffset) === 0 ? { features: [{}, {}] } : { features: [] }),
      base: "b",
      total: 10,
      page: 5,
      onFeatures: () => {},
      onShortPage: (e) => seen.push(e),
    });
    expect(seen[0]).toEqual({ offset: 0, got: 2 });
    expect(seen[1]).toEqual({ offset: 2, got: 0 });
  });
});
