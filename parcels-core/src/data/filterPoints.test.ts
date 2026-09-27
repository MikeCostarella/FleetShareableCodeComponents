// Tests for the parcel visibility filters (Statehouse Sprint 1, issue #1).
//
// filterPoints is the single source of truth for which parcels the map layer
// and the list view show — they can never disagree unless one of these tests
// fails first. The owner-search flag is a privacy setting: owner names must
// match ONLY when it is explicitly on.

import { describe, expect, it } from "vitest";
import { filterPoints, findPoint, hasRange, matches, textMatches } from "./filterPoints";
import type { Parcel } from "../types/point";

/** A realistic parcel with every field filled; override what the test needs. */
function parcel(overrides: Partial<Parcel> = {}): Parcel {
  return {
    parcelNumber: "010-000001-00",
    owner: "SMITH JOHN A",
    description: "LOT 12 MAPLE GROVE",
    landUse: "510",
    type: 5,
    jurisdiction: "Columbus",
    taxingDistrict: "",
    township: "",
    acres: 0.25,
    landMarket: 40000,
    buildingMarket: 160000,
    totalMarket: 200000,
    totalAssessed: 70000,
    saleDate: "2021-06-15",
    address: "123 MAPLE ST",
    zip: "43215",
    lat: 39.96,
    lon: -83.0,
    hasCoord: true,
    approxCoord: false,
    auditorId: "123456",
    ...overrides,
  };
}

describe("textMatches", () => {
  const p = parcel();

  it("matches parcel number, address, and zip, case-insensitively", () => {
    expect(textMatches(p, "010-000001")).toBe(true);
    expect(textMatches(p, "maple st")).toBe(true);
    expect(textMatches(p, "43215")).toBe(true);
    expect(textMatches(p, "MAPLE")).toBe(true);
  });

  it("matches owner ONLY when includeOwner is on (the privacy flag)", () => {
    expect(textMatches(p, "smith")).toBe(false);        // default: owner not searched
    expect(textMatches(p, "smith", false)).toBe(false);
    expect(textMatches(p, "smith", true)).toBe(true);
  });

  it("treats a blank or whitespace query as a match", () => {
    expect(textMatches(p, "")).toBe(true);
    expect(textMatches(p, "   ")).toBe(true);
  });

  it("rejects a query matching nothing", () => {
    expect(textMatches(p, "zzz-nope")).toBe(false);
  });
});

describe("textMatches (pasted mailing addresses, 1.10.0)", () => {
  // Portage, Sept 2026: stored without the street suffix, and with the
  // township rather than the post-office name as the city.
  const portage = parcel({
    parcelNumber: "28-063-00-00-003-000",
    address: "4761 WATERLOO, Randolph Township, OH 44201",
    zip: "44201",
  });
  const withSuffix = parcel({ address: "123 MAPLE ST, Columbus, OH 43215", zip: "43215" });
  const directional = parcel({ address: "500 N HIGH ST", zip: "43215" });

  it("finds a parcel from a full mailing address with suffix, postal city and ZIP", () => {
    expect(textMatches(portage, "4761 Waterloo Rd, Atwater, OH 44201")).toBe(true);
    expect(textMatches(portage, "4761 Waterloo Road, Atwater, Ohio 44201-1234")).toBe(true);
    expect(textMatches(portage, "4761 waterloo rd atwater oh 44201")).toBe(true);
    expect(textMatches(portage, "4761 Waterloo Rd")).toBe(true);
  });

  it("still requires the house number and street words", () => {
    expect(textMatches(portage, "4762 Waterloo Rd, Atwater, OH 44201")).toBe(false);
    expect(textMatches(portage, "476 Waterloo Rd")).toBe(false);          // numbers are exact
    expect(textMatches(portage, "4761 Portage Rd, Atwater, OH 44201")).toBe(false);
  });

  it("requires a ZIP given in the locality to match", () => {
    expect(textMatches(portage, "4761 Waterloo Rd, Atwater, OH 44266")).toBe(false);
  });

  it("matches suffixes in either spelling, but rejects a different stored suffix", () => {
    expect(textMatches(withSuffix, "123 Maple Street, Columbus, OH")).toBe(true);
    expect(textMatches(withSuffix, "123 Maple Ave, Columbus, OH")).toBe(false);
  });

  it("matches directionals softly the same way", () => {
    expect(textMatches(directional, "500 North High Street")).toBe(true);
    expect(textMatches(directional, "500 S High St")).toBe(false);
    expect(textMatches(withSuffix, "123 E Maple St")).toBe(true);         // none stored
  });

  it("keeps the literal first pass: partial typing and parcel numbers", () => {
    expect(textMatches(portage, "4761 water")).toBe(true);
    expect(textMatches(portage, "28-063-00")).toBe(true);
  });

  it("does not let the address pass search owner names unless includeOwner is on", () => {
    const p = parcel({ owner: "SMITH JOHN A" });
    expect(textMatches(p, "john smith")).toBe(false);
    expect(textMatches(p, "john smith", true)).toBe(true);
  });

  it("matches State Route against the stored ST RT", () => {
    const sr = parcel({ address: "9668 ST RT 224, Deerfield Township, OH 44411", zip: "44411" });
    expect(textMatches(sr, "9668 State Route 224, Deerfield, OH 44411")).toBe(true);
    expect(textMatches(sr, "9668 State Route 225")).toBe(false);
  });

  it("treats a query with nothing but a state as matching nothing", () => {
    expect(textMatches(portage, "Ohio, USA")).toBe(false);
  });
});

describe("matches (range bounds)", () => {
  const p = parcel(); // totalMarket 200000, acres 0.25

  it("treats every bound as inclusive", () => {
    expect(matches(p, undefined, undefined, { minValue: 200000 })).toBe(true);
    expect(matches(p, undefined, undefined, { maxValue: 200000 })).toBe(true);
    expect(matches(p, undefined, undefined, { minAcres: 0.25 })).toBe(true);
    expect(matches(p, undefined, undefined, { maxAcres: 0.25 })).toBe(true);
  });

  it("rejects values outside each bound", () => {
    expect(matches(p, undefined, undefined, { minValue: 200001 })).toBe(false);
    expect(matches(p, undefined, undefined, { maxValue: 199999 })).toBe(false);
    expect(matches(p, undefined, undefined, { minAcres: 0.26 })).toBe(false);
    expect(matches(p, undefined, undefined, { maxAcres: 0.24 })).toBe(false);
  });

  it("filters by major class and jurisdiction sets", () => {
    expect(matches(p, new Set([5]))).toBe(true);
    expect(matches(p, new Set([1, 2]))).toBe(false);
    expect(matches(p, undefined, new Set(["Columbus"]))).toBe(true);
    expect(matches(p, undefined, new Set(["Dublin"]))).toBe(false);
  });
});

describe("hasRange", () => {
  it("is false for no range or an empty range object", () => {
    expect(hasRange(undefined)).toBe(false);
    expect(hasRange({})).toBe(false);
  });

  it("is true when any single bound is set", () => {
    expect(hasRange({ minValue: 1 })).toBe(true);
    expect(hasRange({ maxValue: 1 })).toBe(true);
    expect(hasRange({ minAcres: 1 })).toBe(true);
    expect(hasRange({ maxAcres: 1 })).toBe(true);
  });
});

describe("filterPoints", () => {
  const columbus = parcel({ parcelNumber: "010-1", jurisdiction: "Columbus", type: 5, totalMarket: 200000 });
  const dublinCommercial = parcel({ parcelNumber: "010-2", jurisdiction: "Dublin", type: 4, totalMarket: 900000, address: "500 CORPORATE DR" });
  const dublinHouse = parcel({ parcelNumber: "010-3", jurisdiction: "Dublin", type: 5, totalMarket: 350000 });
  const all = [columbus, dublinCommercial, dublinHouse];

  it("returns the SAME array when no filter is active (fast path)", () => {
    expect(filterPoints(all)).toBe(all);
    expect(filterPoints(all, undefined, undefined, {}, "")).toBe(all);
  });

  it("applies a single dimension", () => {
    expect(filterPoints(all, undefined, new Set(["Dublin"]))).toEqual([dublinCommercial, dublinHouse]);
    expect(filterPoints(all, new Set([4]))).toEqual([dublinCommercial]);
  });

  it("composes dimensions with AND", () => {
    // Dublin AND residential AND under $500k -> only the Dublin house
    expect(
      filterPoints(all, new Set([5]), new Set(["Dublin"]), { maxValue: 500000 }),
    ).toEqual([dublinHouse]);
    // Dublin AND residential AND over $500k -> nothing
    expect(
      filterPoints(all, new Set([5]), new Set(["Dublin"]), { minValue: 500001 }),
    ).toEqual([]);
  });

  it("combines text search with the other dimensions", () => {
    expect(filterPoints(all, undefined, new Set(["Dublin"]), undefined, "corporate")).toEqual([dublinCommercial]);
  });
});

describe("findPoint", () => {
  const first = parcel({ parcelNumber: "010-1", address: "1 OAK ST" });
  const second = parcel({ parcelNumber: "010-2", address: "2 OAK ST" });

  it("returns the first match in array order", () => {
    expect(findPoint([first, second], "OAK ST")).toBe(first);
  });

  it("returns null for a blank query or no match", () => {
    expect(findPoint([first, second], "")).toBeNull();
    expect(findPoint([first, second], "   ")).toBeNull();
    expect(findPoint([first, second], "ELM")).toBeNull();
  });

  it("respects the owner privacy flag", () => {
    const owned = parcel({ owner: "COSTARELLA MIKE" });
    expect(findPoint([owned], "costarella")).toBeNull();
    expect(findPoint([owned], "costarella", true)).toBe(owned);
  });
});

describe("taxing-district filter", () => {
  // Adams publishes a taxing district; Franklin does not, so Parcel.taxingDistrict
  // is "" there. A county with no districts never passes a set, and the dimension
  // is simply inert — that is the case worth pinning, because the sweep will put
  // this code in 88 repos where most of them look like Franklin.
  const a = parcel({ parcelNumber: "A-1", taxingDistrict: "MEIGS TWP" });
  const b = parcel({ parcelNumber: "B-1", taxingDistrict: "TIFFIN TWP" });
  const none = parcel({ parcelNumber: "C-1", taxingDistrict: "" });

  it("keeps only parcels whose district is selected", () => {
    const out = filterPoints([a, b, none], undefined, undefined, undefined, "", false, new Set(["MEIGS TWP"]));
    expect(out.map((p) => p.parcelNumber)).toEqual(["A-1"]);
  });

  it("does not filter when no district set is given", () => {
    const out = filterPoints([a, b, none], undefined, undefined, undefined, "", false, undefined);
    expect(out).toHaveLength(3);
  });

  it("excludes parcels with no district when a set is active", () => {
    const out = filterPoints([a, none], undefined, undefined, undefined, "", false, new Set(["MEIGS TWP"]));
    expect(out.map((p) => p.parcelNumber)).toEqual(["A-1"]);
  });

  it("combines with the other dimensions (AND)", () => {
    const rich = parcel({ parcelNumber: "D-1", taxingDistrict: "MEIGS TWP", totalMarket: 500000 });
    const poor = parcel({ parcelNumber: "E-1", taxingDistrict: "MEIGS TWP", totalMarket: 1000 });
    const out = filterPoints(
      [rich, poor],
      undefined,
      undefined,
      { minValue: 100000 },
      "",
      false,
      new Set(["MEIGS TWP"]),
    );
    expect(out.map((p) => p.parcelNumber)).toEqual(["D-1"]);
  });
});

describe("generic over a widened parcel type", () => {
  // The pilot's blocker, pinned. A county that adds fields must get its own type
  // back from filterPoints/findPoint; when these were typed against the core
  // Parcel, a county reading its own field off a filtered result stopped
  // compiling. These assertions are as much for tsc as for the runtime.
  interface AdamsParcel extends Parcel {
    tract: string;
    foodDesert: boolean;
    pin: string;
  }

  function adams(overrides: Partial<AdamsParcel> = {}): AdamsParcel {
    return { ...parcel(), tract: "39001960100", foodDesert: false, pin: "A00-000-00", ...overrides };
  }

  it("filterPoints returns the county's own type, not the core one", () => {
    const wide: AdamsParcel[] = [adams({ tract: "39001960100" }), adams({ tract: "39001960200" })];
    const out = filterPoints(wide);
    // If the return type had narrowed to Parcel, this line would not compile.
    expect(out[0].tract).toBe("39001960100");
    expect(out).toHaveLength(2);
  });

  it("findPoint returns the county's own type", () => {
    const wide: AdamsParcel[] = [adams({ parcelNumber: "X-9", pin: "PIN-9" })];
    const hit = findPoint(wide, "X-9");
    expect(hit?.pin).toBe("PIN-9");
  });

  it("still infers the core type for counties that add nothing", () => {
    const plain: Parcel[] = [parcel()];
    const out = filterPoints(plain);
    expect(out[0].parcelNumber).toBe("010-000001-00");
  });
});
