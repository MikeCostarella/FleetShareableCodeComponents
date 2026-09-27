// Tests for the extracted parcel-build helpers (Statehouse Sprint 1, issue #6).
// The worked examples come straight from the fleet's HANDOFF notes — real
// parcels, real dollars, real bugs.

import { describe, expect, it } from "vitest";
import {
  assessedPart,
  assessedValue,
  clean,
  isSchool,
  medianAssessedRatio,
  num,
  parseDistrict,
  saleDate,
  titleCase,
} from "./parcelBuild.mjs";

describe("assessed value rules", () => {
  it("components rule: 35% of land and building separately, each rounded to $10, then summed (Lorain's worked example)", () => {
    expect(assessedPart(73050)).toBe(25570);   // land
    expect(assessedPart(302510)).toBe(105880); // building
    expect(assessedValue(73050, 302510, 375560, "components")).toBe(131450);
  });

  it("total rule: 35% of the total, rounded to $10 (Delaware's worked example)", () => {
    expect(assessedValue(73050, 302510, 375560, "total")).toBe(131450);
    // The two conventions AGREE on this example — which is exactly why it took
    // a disagreeing parcel and a live Auditor record to tell them apart.
  });

  it("the two conventions disagree when both parts round the same way", () => {
    // 15 + 15: each part 5.25 -> $10, summed $20; total 10.50 -> $10.
    expect(assessedValue(15, 15, 30, "components")).toBe(20);
    expect(assessedValue(15, 15, 30, "total")).toBe(10);
  });
});

describe("medianAssessedRatio — the 0.3500 sanity check", () => {
  const healthy = [
    { tm: 200000, ta: 70000 },
    { tm: 100000, ta: 35000 },
    { tm: 300000, ta: 105000 },
  ];

  it("lands on 0.35 for a correctly mapped county", () => {
    expect(medianAssessedRatio(healthy)).toBeCloseTo(0.35, 4);
  });

  it("flags a mis-mapped column immediately (assessed column = market column)", () => {
    // Delaware's trap in reverse: if ta were mistakenly the market value,
    // every ratio is 1.0 and the median screams.
    const misMapped = healthy.map((p) => ({ tm: p.tm, ta: p.tm }));
    const median = medianAssessedRatio(misMapped);
    expect(Math.abs(median - 0.35) > 0.001).toBe(true);
  });

  it("ignores zero-value (exempt) parcels and returns null when nothing qualifies", () => {
    expect(medianAssessedRatio([{ tm: 0, ta: 0 }, ...healthy])).toBeCloseTo(0.35, 4);
    expect(medianAssessedRatio([{ tm: 0, ta: 0 }])).toBeNull();
    expect(medianAssessedRatio([])).toBeNull();
  });
});

describe("placeholder cleaning", () => {
  it("clean collapses whitespace and blanks null/undefined", () => {
    expect(clean("  SMITH   JOHN  ")).toBe("SMITH JOHN");
    expect(clean(null)).toBe("");
    expect(clean(undefined)).toBe("");
  });

  it("num maps non-finite to 0", () => {
    expect(num("42.5")).toBe(42.5);
    expect(num("")).toBe(0);
    expect(num("N/A")).toBe(0);
    expect(num(null)).toBe(0);
  });

  it("saleDate rejects the 1900-01-01 placeholder and epoch 0 (Greene's 22,900 phantom sales)", () => {
    expect(saleDate(Date.UTC(1900, 0, 1))).toBe("");  // the placeholder itself
    expect(saleDate(0)).toBe("");                      // epoch zero = never sold
    expect(saleDate(null)).toBe("");
    expect(saleDate("")).toBe("");
    expect(saleDate("garbage")).toBe("");
  });

  it("saleDate keeps real dates, including just past the floor", () => {
    expect(saleDate(Date.UTC(1900, 0, 2))).toBe("1900-01-02"); // floor is >, not >=
    expect(saleDate(Date.UTC(2021, 5, 15))).toBe("2021-06-15");
  });
});

describe("parseDistrict — the CVTTXDSCRP jurisdiction parser", () => {
  // Every case below is a real Franklin County taxing-district string from
  // the HANDOFF notes. The build prints all districts for eyeball review;
  // these pin the ones that were verified.
  it("handles the documented district shapes", () => {
    expect(parseDistrict("CITY OF COLUMBUS")).toEqual({ jurisdiction: "Columbus", township: "" });
    expect(parseDistrict("COLUMBUS-SOUTHWESTERN CSD")).toEqual({ jurisdiction: "Columbus", township: "" });
    expect(parseDistrict("CITY OF GAHANNA-GAHANNA JEFFERSON")).toEqual({ jurisdiction: "Gahanna", township: "" });
    expect(parseDistrict("CITY OF DUBLIN-WASH TWP-DUBLIN")).toEqual({ jurisdiction: "Dublin", township: "Wash Township" });
    expect(parseDistrict("PLAIN TWP-NEW ALBANY CORP")).toEqual({ jurisdiction: "New Albany", township: "Plain Township" });
    expect(parseDistrict("PRAIRIE TOWNSHIP")).toEqual({ jurisdiction: "Prairie Township", township: "" });
  });

  it("school segments are never a jurisdiction", () => {
    expect(isSchool("SOUTHWESTERN CSD")).toBe(true);
    expect(isSchool("GAHANNA JEFFERSON CITY SCHOOLS")).toBe(true);
    expect(isSchool("CITY OF COLUMBUS")).toBe(false);
  });

  it("blank input is Unassigned", () => {
    expect(parseDistrict("")).toEqual({ jurisdiction: "Unassigned", township: "" });
    expect(parseDistrict(null)).toEqual({ jurisdiction: "Unassigned", township: "" });
  });

  it("titleCase handles Mc names", () => {
    expect(titleCase("MCDONALD")).toBe("McDonald");
    expect(titleCase("UPPER ARLINGTON")).toBe("Upper Arlington");
  });
});
