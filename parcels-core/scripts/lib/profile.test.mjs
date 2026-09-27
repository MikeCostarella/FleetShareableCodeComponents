// Tests for the source-data profiler (Statehouse #17).
// Each case is a real finding from the fleet's inspect-report.txt files.

import { describe, expect, it } from "vitest";
import {
  OWNER_SENTINELS,
  PLACEHOLDER_DATE_FLOOR,
  VALUE_COL_RE,
  classifyRatio,
  detectPlaceholderValues,
  distinctCounts,
  findDateColumns,
  formatCoverage,
  formatDateProfile,
  formatDistinct,
  isBlank,
  pairwiseRatioReport,
  profileColumns,
  profileDates,
  ratioMedian,
  valueColumnCandidates,
} from "./profile.mjs";

describe("isBlank", () => {
  it("treats null, undefined and whitespace as blank, but not zero", () => {
    expect([null, undefined, "", "   "].every(isBlank)).toBe(true);
    expect([0, "0", false].some(isBlank)).toBe(false);
  });
});

describe("profileColumns", () => {
  const rows = [
    { MUN_NAME: "", ACRES: 0, OWNER: "SMITH" },
    { MUN_NAME: "  ", ACRES: 1.5, OWNER: "JONES" },
    { MUN_NAME: "COLUMBUS", ACRES: 0, OWNER: "" },
  ];

  it("counts blanks and zeros separately — Lorain's acreage was zero on 54.9% of rows", () => {
    const [mun, acres] = profileColumns(rows, ["MUN_NAME", "ACRES"]);
    expect(mun.blank).toBe(2);
    expect(mun.blankPct).toBeCloseTo(66.7, 1);
    expect(acres.blank).toBe(0);
    expect(acres.zero).toBe(2);
  });

  it("reports blankPct as null for an empty sample instead of NaN%", () => {
    expect(profileColumns([], ["ANY"])[0].blankPct).toBeNull();
    expect(formatCoverage(profileColumns([], ["ANY"]))[0]).toContain("n/a");
  });

  it("flags a column that was never requested — Franklin profiled PCLASS it never asked for", () => {
    const [pclass] = profileColumns(rows, ["PCLASS"]);
    expect(pclass.absent).toBe(true);
    expect(formatCoverage([pclass])[0]).toMatch(/never requested/);
  });

  it("measures average serialized bytes when asked", () => {
    const [owner] = profileColumns(rows, ["OWNER"], { withBytes: true });
    expect(owner.avgBytes).toBeGreaterThan(0);
  });
});

describe("distinctCounts / formatDistinct", () => {
  const rows = [
    { CLASS: "R" }, { CLASS: "R" }, { CLASS: "C" }, { CLASS: "" },
  ];

  it("labels blanks rather than dropping them", () => {
    const c = distinctCounts(rows, "CLASS");
    expect(c.get("R")).toBe(2);
    expect(c.get("(blank)")).toBe(1);
  });

  it("prints highest-frequency first and truncates with a count", () => {
    const lines = formatDistinct("CLASS", distinctCounts(rows, "CLASS"), { top: 2 });
    expect(lines[0]).toContain("3 distinct");
    expect(lines[1]).toContain("R");
    expect(lines.at(-1)).toContain("1 more");
  });

  it("skips columns that are constant or high-cardinality", () => {
    const single = new Map([["only", 5]]);
    expect(formatDistinct("X", single)).toBeNull();
    const many = new Map(Array.from({ length: 80 }, (_, i) => [`v${i}`, 1]));
    expect(formatDistinct("X", many)).toBeNull();
  });
});

describe("profileDates", () => {
  it("catches the Greene 1900-01-01 placeholder", () => {
    const p = profileDates([Date.UTC(1900, 0, 1), Date.UTC(2021, 5, 4)]);
    expect(p.ph1900).toBe(1);
    expect(p.max).toBe("2021-06-04");
    expect(formatDateProfile("SALEDATE", p).join("\n")).toMatch(/placeholders, not sales/);
  });

  it("does not treat an empty string as a 1970 conveyance — Delaware's silent epoch bug", () => {
    const p = profileDates(["", "   ", Date.UTC(2019, 0, 15)]);
    expect(p.nonBlank).toBe(1);
    expect(p.parsed).toBe(1);
    expect(p.min).toBe("2019-01-15");
    expect(p.phEpoch).toBe(0);
  });

  it("does flag a genuine zero epoch", () => {
    expect(profileDates([0]).phEpoch).toBe(1);
  });

  it("flags Franklin's second placeholder shape in the 1900-1910 window", () => {
    const p = profileDates([Date.UTC(1900, 1, 26)]);
    expect(p.phEarly).toBe(1);
    expect(formatDateProfile("SALEDATE", p).join("\n")).toContain("1900-02-26");
  });

  it("never prints an undefined range when nothing parsed", () => {
    const p = profileDates(["not a date", "also not"]);
    expect(p.parsed).toBe(0);
    expect(formatDateProfile("DISTRICT_DT", p).join("\n")).not.toMatch(/undefined/);
  });

  it("says so when a column is clean", () => {
    const p = profileDates([Date.UTC(2020, 0, 1)]);
    expect(formatDateProfile("SALEDATE", p).join("\n")).toContain("no placeholder shapes");
  });

  it("shares its floor with saleDate() in parcelBuild.mjs", () => {
    expect(PLACEHOLDER_DATE_FLOOR).toBe("1900-01-01");
  });
});

describe("findDateColumns", () => {
  it("takes date-typed and date-named columns", () => {
    expect(
      findDateColumns([
        { name: "SALEDATE", type: "esriFieldTypeString" },
        { name: "TRANSFER_DT", type: "esriFieldTypeString" },
        { name: "WHEN", type: "esriFieldTypeDate" },
        { name: "OWNER", type: "esriFieldTypeString" },
      ]),
    ).toEqual(["SALEDATE", "TRANSFER_DT", "WHEN"]);
  });
});

describe("detectPlaceholderValues — the owner-side check no inspector had", () => {
  it("finds sentinel owner names", () => {
    const rows = [
      { OWNER: "SMITH JOHN" }, { OWNER: "UNKNOWN" }, { OWNER: "unknown" },
      { OWNER: "N/A" }, { OWNER: "" },
    ];
    const r = detectPlaceholderValues(rows, "OWNER");
    expect(r.total).toBe(3);
    expect(r.hits.get("UNKNOWN")).toBe(2);
    expect(r.pct).toBe(60);
  });

  it("ships a sentinel list rather than making every county invent one", () => {
    expect(OWNER_SENTINELS).toContain("CURRENT OWNER");
  });
});

describe("value columns and the 0.3500 test", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    MARKET_TOT: 100_000 + i * 1000,
    ASSD_TOT: Math.round((100_000 + i * 1000) * 0.35),
    OWNER: "SMITH",
  }));

  it("the candidate regex is the union of the two that drifted apart", () => {
    expect(VALUE_COL_RE.test("TAX_VALUE")).toBe(true); // Hamilton's regex missed this
    expect(VALUE_COL_RE.test("MARKET_IMPR")).toBe(true); // Cuyahoga's missed this
    expect(VALUE_COL_RE.test("OWNER")).toBe(false);
  });

  it("finds populated numeric value columns and ignores the rest", () => {
    expect(valueColumnCandidates(rows, ["MARKET_TOT", "ASSD_TOT", "OWNER"])).toEqual([
      "MARKET_TOT",
      "ASSD_TOT",
    ]);
  });

  it("lands the assessed/market median on 0.3500", () => {
    const r = ratioMedian(rows, "MARKET_TOT", "ASSD_TOT");
    expect(r.n).toBe(100);
    expect(r.median).toBeCloseTo(0.35, 4);
    expect(classifyRatio(r.median)).toMatch(/ORC 5713.03/);
  });

  it("names a 100% column, which must be derived rather than used directly", () => {
    expect(classifyRatio(1.0)).toMatch(/derived/);
  });

  it("reports each pair one way round and says when there is no CAMA at all", () => {
    expect(pairwiseRatioReport(rows, ["MARKET_TOT", "ASSD_TOT"])).toHaveLength(1);
    expect(pairwiseRatioReport([], ["A", "B"])[0]).toMatch(/none/);
  });

  it("ignores rows where the denominator is zero or blank", () => {
    const dirty = [{ M: 0, A: 5 }, { M: "", A: 5 }, { M: 100, A: 35 }];
    expect(ratioMedian(dirty, "M", "A")).toEqual({ median: 0.35, n: 1 });
  });
});
