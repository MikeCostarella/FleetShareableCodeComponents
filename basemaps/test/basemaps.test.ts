import { describe, expect, it } from "vitest";
import {
  AERIAL_MAX_ZOOM,
  BASE_MAP_IDS,
  BASE_MAP_LABELS,
  BASE_MAP_STORAGE_KEY,
  CARTO_KEY,
  DEFAULT_BASE_MAP,
  OSIP_AERIAL,
  isBaseMapId,
  maxZoomFor,
  readStoredBaseMap,
  writeStoredBaseMap,
} from "../src/basemaps";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("isBaseMapId", () => {
  it("accepts the three ids and nothing else", () => {
    for (const id of BASE_MAP_IDS) expect(isBaseMapId(id)).toBe(true);
    expect(isBaseMapId("satellite")).toBe(false);
    expect(isBaseMapId(null)).toBe(false);
    expect(isBaseMapId(undefined)).toBe(false);
    expect(isBaseMapId(1)).toBe(false);
  });
  it("has a label for every id", () => {
    for (const id of BASE_MAP_IDS) expect(BASE_MAP_LABELS[id]).toBeTruthy();
  });
});

describe("stored choice", () => {
  it("defaults when nothing is stored", () => {
    expect(readStoredBaseMap(fakeStorage())).toBe(DEFAULT_BASE_MAP);
  });
  it("defaults when the stored value is not a base map id", () => {
    expect(readStoredBaseMap(fakeStorage({ [BASE_MAP_STORAGE_KEY]: "satellite" }))).toBe(DEFAULT_BASE_MAP);
  });
  it("round-trips a valid choice under the shared key", () => {
    const s = fakeStorage();
    writeStoredBaseMap("hybrid", s);
    expect(s.data.get(BASE_MAP_STORAGE_KEY)).toBe("hybrid");
    expect(readStoredBaseMap(s)).toBe("hybrid");
  });
  it("defaults when storage is missing or throws", () => {
    expect(readStoredBaseMap(null)).toBe(DEFAULT_BASE_MAP);
    const angry = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredBaseMap(angry)).toBe(DEFAULT_BASE_MAP);
    expect(() => writeStoredBaseMap("aerial", angry)).not.toThrow();
    expect(() => writeStoredBaseMap("aerial", null)).not.toThrow();
  });
});

describe("maxZoomFor", () => {
  it("leaves streets at the app's own ceiling", () => {
    expect(maxZoomFor("streets")).toBe(19);
    expect(maxZoomFor("streets", 18)).toBe(18);
  });
  it("lets aerial and hybrid go one level past the native OSIP tiles", () => {
    expect(AERIAL_MAX_ZOOM).toBe(OSIP_AERIAL.maxNativeZoom + 1);
    expect(maxZoomFor("aerial")).toBe(AERIAL_MAX_ZOOM);
    expect(maxZoomFor("hybrid")).toBe(AERIAL_MAX_ZOOM);
  });
  it("never lowers a ceiling an app already set higher", () => {
    expect(maxZoomFor("aerial", 22)).toBe(22);
  });
});

describe("tile specs", () => {
  it("OSIP is the ArcGIS tile cache in {z}/{y}/{x} order (row before column)", () => {
    expect(OSIP_AERIAL.url).toMatch(/\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
    expect(OSIP_AERIAL.url.startsWith("https://maps.ohio.gov/")).toBe(true);
  });
  it("CARTO key is the fleet key added Aug 2026", () => {
    expect(CARTO_KEY).toBe("cb1_2mty_1_1564a95dd2e80809e16b1914");
  });
});
