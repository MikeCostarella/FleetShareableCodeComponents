// Tests for the display formatters (Statehouse Sprint 1, issue #5).
//
// These pin behaviors that were paid for in real debugging time — above all
// the Greene County sliver bug: at two decimal places, 243 real parcels
// between zero and half a hundredth of an acre rendered "0 ac" while the
// Auditor's own page showed a real figure, and another 631 parcels between
// 0.005 and 0.01 rounded to a misleading "0.01". Reporting zero for land
// that exists is worse than an extra decimal place; these tests make that
// rule permanent.

import { describe, expect, it } from "vitest";
import { acres, money, saleDate } from "./format";

describe("money", () => {
  it("formats whole dollars with thousands separators and no decimals", () => {
    expect(money(198800)).toBe("$198,800"); // the doc-comment example
    expect(money(0)).toBe("$0");
  });

  it("rounds fractional amounts to the nearest dollar", () => {
    expect(money(1234.56)).toBe("$1,235");
    expect(money(1234.4)).toBe("$1,234");
  });

  it("renders an em dash for missing or non-finite values", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(NaN)).toBe("—");
    expect(money(Infinity)).toBe("—");
  });
});

describe("acres", () => {
  it("gives sliver parcels four decimals — the Greene bug (parcel A02-0001-0020-0-0174-00 was 0.0039 ac, shown as '0 ac')", () => {
    expect(acres(0.0039)).toBe("0.0039 ac");
    expect(acres(0.0039)).not.toBe("0 ac");
  });

  it("keeps four decimals through the 0.005–0.01 band instead of rounding to '0.01' (631 real Greene parcels)", () => {
    expect(acres(0.005)).toBe("0.005 ac");
    expect(acres(0.0075)).toBe("0.0075 ac");
    expect(acres(0.0099)).toBe("0.0099 ac");
  });

  it("uses two decimals from a hundredth of an acre up", () => {
    expect(acres(0.01)).toBe("0.01 ac"); // boundary: exactly 0.01 is the two-decimal side
    expect(acres(2.9)).toBe("2.9 ac");   // the doc-comment example
    expect(acres(1234.567)).toBe("1,234.57 ac");
  });

  it("renders true zero as '0 ac' (only positive slivers get the four-decimal rule)", () => {
    expect(acres(0)).toBe("0 ac");
  });

  it("renders an em dash for missing or non-finite values", () => {
    expect(acres(null)).toBe("—");
    expect(acres(undefined)).toBe("—");
    expect(acres(NaN)).toBe("—");
  });
});

describe("saleDate", () => {
  it("passes real date strings through untouched", () => {
    expect(saleDate("2020-01-02")).toBe("2020-01-02");
  });

  it("renders an em dash for missing or blank values", () => {
    expect(saleDate(null)).toBe("—");
    expect(saleDate(undefined)).toBe("—");
    expect(saleDate("")).toBe("—");
    expect(saleDate("   ")).toBe("—");
  });
});
