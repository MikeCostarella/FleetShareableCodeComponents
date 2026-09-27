// Tests for address-lookup. The fixtures mirror real Census geocoder answers
// captured 27 Sep 2026 (trimmed to the fields the module reads).

import { describe, expect, it, vi } from "vitest";
import {
  geocoderUrl,
  lookupWithFetch,
  lookupWithJsonp,
  parcelsLink,
  parseMatches,
  resolve,
} from "../src/addressLookup.js";
import { PARCELS_APPS } from "../src/parcelsApps.js";
import { readDeepLink } from "../../parcels-core/src/data/deepLink";

const match = (address, x, y, geoid, name) => ({
  matchedAddress: address,
  coordinates: { x, y },
  geographies: { Counties: geoid ? [{ GEOID: geoid, NAME: name }] : [] },
});
const answer = (...ms) => ({ result: { addressMatches: ms } });

const WATERLOO = answer(match("4761 WATERLOO RD, ATWATER, OH, 44201", -81.220906608232, 41.032631675101, "39133", "Portage County"));
const MAIN_ST = answer(
  match("100 W MAIN ST, COLUMBUS, OH, 43215", -83.0, 39.96, "39049", "Franklin County"),
  match("100 E MAIN ST, COLUMBUS, OH, 43215", -82.99, 39.96, "39049", "Franklin County"),
);
const PITTSBURGH = answer(match("123 MAIN ST, PITTSBURGH, PA, 15215", -79.9, 40.5, "42003", "Allegheny County"));

describe("geocoderUrl", () => {
  it("asks for JSON, or JSONP with a callback, with the county layer", () => {
    const json = new URL(geocoderUrl("  4761 Waterloo Rd, Atwater, OH 44201 "));
    expect(json.origin + json.pathname).toBe("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
    expect(json.searchParams.get("address")).toBe("4761 Waterloo Rd, Atwater, OH 44201");
    expect(json.searchParams.get("format")).toBe("json");
    expect(json.searchParams.get("layers")).toBe("Counties");
    const jsonp = new URL(geocoderUrl("x", "cb1"));
    expect(jsonp.searchParams.get("format")).toBe("jsonp");
    expect(jsonp.searchParams.get("callback")).toBe("cb1");
  });
});

describe("parseMatches", () => {
  it("reads address, street, zip, point and county", () => {
    expect(parseMatches(WATERLOO)).toEqual([{
      address: "4761 WATERLOO RD, ATWATER, OH, 44201",
      street: "4761 WATERLOO RD",
      zip: "44201",
      lat: 41.032631675101,
      lon: -81.220906608232,
      countyFips: "39133",
      countyName: "Portage County",
    }]);
  });

  it("skips malformed matches and survives garbage", () => {
    expect(parseMatches(null)).toEqual([]);
    expect(parseMatches({ result: {} })).toEqual([]);
    expect(parseMatches(answer({ matchedAddress: "X", coordinates: { x: "nope" } }))).toEqual([]);
  });
});

describe("parcelsLink", () => {
  it("deep-links street + ZIP and the point, readable by parcels-core", () => {
    const link = parcelsLink(parseMatches(WATERLOO)[0]);
    expect(link.county).toBe("Portage");
    expect(link.url).toBe(
      "https://mikecostarella.github.io/PortageCountyParcels/?q=4761+WATERLOO+RD%2C+44201&lat=41.032632&lon=-81.220907",
    );
    // The contract with the apps: parcels-core's own parser must read it back.
    expect(readDeepLink(new URL(link.url).search)).toEqual({ q: "4761 WATERLOO RD, 44201", lat: 41.032632, lon: -81.220907 });
  });

  it("is null for a county with no app", () => {
    expect(parcelsLink(parseMatches(PITTSBURGH)[0])).toBeNull();
  });
});

describe("resolve", () => {
  it("classifies found / none / not-ohio / no-app", () => {
    expect(resolve(WATERLOO).status).toBe("found");
    const both = resolve(MAIN_ST);
    expect(both.status).toBe("found");
    expect(both.links.map((l) => l.match.street)).toEqual(["100 W MAIN ST", "100 E MAIN ST"]);
    expect(resolve(answer()).status).toBe("none");
    expect(resolve(PITTSBURGH).status).toBe("not-ohio");
    expect(resolve(WATERLOO, {}).status).toBe("no-app");
  });
});

describe("PARCELS_APPS", () => {
  it("covers all 88 Ohio counties with one https app each", () => {
    const fips = Object.keys(PARCELS_APPS);
    expect(fips).toHaveLength(88);
    // Ohio county FIPS are the odd numbers 39001..39175.
    expect(fips.sort()).toEqual(Array.from({ length: 88 }, (_, i) => "39" + String(2 * i + 1).padStart(3, "0")));
    for (const { url } of Object.values(PARCELS_APPS)) expect(url).toMatch(/^https:\/\/mikecostarella\.github\.io\/\w+CountyParcels\/$/);
  });
});

describe("lookupWithFetch", () => {
  it("resolves a good answer", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => WATERLOO }));
    const r = await lookupWithFetch("4761 Waterloo Rd", f);
    expect(r.status).toBe("found");
    expect(f.mock.calls[0][0]).toContain("format=json");
  });

  it("reports HTTP and network failures as errors, and skips a blank address", async () => {
    expect((await lookupWithFetch("x", async () => ({ ok: false, status: 503 }))).status).toBe("error");
    expect((await lookupWithFetch("x", async () => { throw new TypeError("offline"); })).status).toBe("error");
    const f = vi.fn();
    expect((await lookupWithFetch("   ", f)).status).toBe("none");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("lookupWithJsonp", () => {
  /** A minimal document whose <script> "loads" by calling the callback. */
  function fakeDom(respond) {
    const win = {};
    const doc = {
      createElement: () => {
        const s = { remove: vi.fn(), onerror: null, src: "" };
        return s;
      },
      head: {
        appendChild: (s) => {
          const cb = new URL(s.src).searchParams.get("callback");
          setTimeout(() => respond(s, win[cb]), 0);
        },
      },
    };
    return { doc, win };
  }

  it("resolves through the callback and cleans up", async () => {
    const { doc, win } = fakeDom((_s, cb) => cb(WATERLOO));
    const r = await lookupWithJsonp("4761 Waterloo Rd", { doc, win });
    expect(r.status).toBe("found");
    expect(Object.keys(win).filter((k) => win[k] !== undefined)).toEqual([]);
  });

  it("reports a script error and a timeout", async () => {
    const bad = fakeDom((s) => s.onerror());
    expect((await lookupWithJsonp("x", bad)).status).toBe("error");
    const silent = fakeDom(() => {});
    expect((await lookupWithJsonp("x", { ...silent, timeoutMs: 20 })).error).toBe("geocoder timed out");
  });
});
