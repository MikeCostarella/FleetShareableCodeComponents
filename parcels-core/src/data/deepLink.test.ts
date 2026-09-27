// Tests for parcels-app deep links (parcels-core 1.11.0). The hub and the
// browser extension build these URLs; every parcels app reads them on load.

import { describe, expect, it } from "vitest";
import { deepLinkSearch, readDeepLink } from "./deepLink";

describe("readDeepLink", () => {
  it("reads an address with its geocoded point", () => {
    expect(readDeepLink("?q=4761%20WATERLOO%20RD%2C%2044201&lat=41.032632&lon=-81.220907")).toEqual({
      q: "4761 WATERLOO RD, 44201",
      lat: 41.032632,
      lon: -81.220907,
    });
  });

  it("reads a query alone, or a point alone", () => {
    expect(readDeepLink("?q=28-063-00-00-003-000")).toEqual({ q: "28-063-00-00-003-000" });
    expect(readDeepLink("?lat=41.03&lon=-81.22")).toEqual({ q: "", lat: 41.03, lon: -81.22 });
  });

  it("returns null when there is nothing to do", () => {
    expect(readDeepLink("")).toBeNull();
    expect(readDeepLink("?q=%20%20")).toBeNull();
    expect(readDeepLink("?utm_source=x")).toBeNull();
  });

  it("drops a malformed or half-given point but keeps the query", () => {
    expect(readDeepLink("?q=main&lat=abc&lon=-81")).toEqual({ q: "main" });
    expect(readDeepLink("?q=main&lat=41")).toEqual({ q: "main" });
    expect(readDeepLink("?q=main&lat=&lon=")).toEqual({ q: "main" });
    expect(readDeepLink("?q=main&lat=141&lon=-81")).toEqual({ q: "main" });
  });

  it("caps an absurdly long query", () => {
    expect(readDeepLink("?q=" + "a".repeat(500))!.q).toHaveLength(200);
  });
});

describe("deepLinkSearch", () => {
  it("round-trips through readDeepLink", () => {
    const link = { q: "4761 WATERLOO RD, 44201", lat: 41.032631675, lon: -81.220906608 };
    const s = deepLinkSearch(link);
    expect(s).toBe("?q=4761+WATERLOO+RD%2C+44201&lat=41.032632&lon=-81.220907");
    expect(readDeepLink(s)).toEqual({ q: link.q, lat: 41.032632, lon: -81.220907 });
  });

  it("is empty for an empty link", () => {
    expect(deepLinkSearch({ q: "" })).toBe("");
  });
});
