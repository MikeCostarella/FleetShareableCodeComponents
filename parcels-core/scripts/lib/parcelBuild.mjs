/**
 * Pure helpers for the parcel build pipeline, extracted from build-parcels.mjs
 * (Statehouse Sprint 1, issue #6) so they are importable and unit-tested.
 * Every function here encodes a hard-won lesson — see the tests for the
 * stories. No I/O, no globals: everything a build script configures is a
 * parameter.
 */

/** Collapse whitespace and trim; null/undefined become "". */
export const clean = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** Number, or 0 for anything non-finite. */
export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 35% of a market figure, rounded to the nearest ten dollars. */
export const assessedPart = (market) => Math.round((market * 0.35) / 10) * 10;

/**
 * Assessed value under a named county convention (ORC 5713.03 is 35% of
 * market, but counties round differently and the difference is real dollars):
 *   "components" — 35% of land and building SEPARATELY, each rounded to the
 *                  nearest $10, then summed (Lorain, Franklin)
 *   "total"      — 35% of the total, rounded to the nearest $10 (Delaware)
 */
export function assessedValue(land, building, totalMarket, rule) {
  return rule === "total"
    ? assessedPart(totalMarket)
    : assessedPart(land) + assessedPart(building);
}

/** Title-case with Mc-name handling ("MCDONALD" -> "McDonald"). */
export function titleCase(s) {
  return clean(s)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => "Mc" + c.toUpperCase());
}

/** School-district segments are never a jurisdiction. */
export const isSchool = (seg) => /\b(CSD|LSD|EVSD|SD|CITY SCHOOLS?|SCHOOLS?)\b/i.test(seg);

/**
 * Decompose a CVTTXDSCRP-style taxing-district string into
 * { jurisdiction, township }. `township` is "" when the jurisdiction IS the
 * township. The build prints every distinct input next to its output — the
 * parser is a guess until that list is read.
 */
export function parseDistrict(raw) {
  const text = clean(raw).toUpperCase();
  if (!text) return { jurisdiction: "Unassigned", township: "" };

  const segments = text.split("-").map((s) => s.trim()).filter(Boolean);

  let municipality = "";
  let township = "";

  for (const seg of segments) {
    if (isSchool(seg)) continue;

    let m;
    if ((m = /^CITY OF\s+(.+)$/.exec(seg))) {
      municipality ||= m[1];
      continue;
    }
    if ((m = /^VILLAGE OF\s+(.+)$/.exec(seg))) {
      municipality ||= m[1];
      continue;
    }
    if ((m = /^(.+?)\s+CORP\.?$/.exec(seg))) {
      municipality ||= m[1];
      continue;
    }
    if ((m = /^(.+?)\s+(TWP|TOWNSHIP)\.?$/.exec(seg))) {
      township ||= m[1];
      continue;
    }
    // A bare leading segment is the municipality: "COLUMBUS-SOUTHWESTERN CSD".
    municipality ||= seg;
  }

  if (municipality) {
    return {
      jurisdiction: titleCase(municipality),
      township: township ? `${titleCase(township)} Township` : "",
    };
  }
  if (township) return { jurisdiction: `${titleCase(township)} Township`, township: "" };
  return { jurisdiction: "Unassigned", township: "" };
}

/**
 * Sale date from epoch milliseconds. Reject anything at or before 1900-01-01:
 * Greene shipped 22,900 parcels claiming to have sold on 1 January 1900
 * because its floor was `>=` rather than `>`, and a zero epoch means
 * "never sold".
 */
export function saleDate(v) {
  if (v === null || v === undefined || v === "") return "";
  const ms = Number(v);
  if (!Number.isFinite(ms) || ms === 0) return "";
  const d = new Date(ms);
  if (Number.isNaN(+d)) return "";
  const iso = d.toISOString().slice(0, 10);
  return iso > "1900-01-01" ? iso : "";
}

/**
 * Median assessed/market ratio across parcels with both values positive, or
 * null when none qualify. THE single-glance sanity check: Ohio assesses at
 * 35% of market, so the median must land on 0.3500 — anything else means a
 * value column is mis-mapped, and this catches it immediately.
 */
export function medianAssessedRatio(parcels) {
  const ratios = parcels
    .filter((p) => p.tm > 0 && p.ta > 0)
    .map((p) => p.ta / p.tm)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  return ratios[Math.floor(ratios.length / 2)];
}
