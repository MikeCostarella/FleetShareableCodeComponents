/**
 * Source-data profiling helpers for inspect-source.mjs (Statehouse #17).
 *
 * WHAT AN INSPECTOR IS FOR
 * ------------------------
 * A column can exist in the schema and be empty in the data — Delaware's
 * MUN_NAME was blank on the first 4,000 rows, Miami's acreage was empty, and
 * Lorain's was zero on 54.9% of rows. None of that throws.
 *
 * Neither does getting the value columns backwards. The assessed/market median
 * must land on 0.3500 (ORC 5713.03); that single number tells you which column
 * is which, and mistaking one for the other mis-states every property by ~3x.
 *
 * Every helper here returns data or lines. None of them print: the caller owns
 * the report sink, so these are testable without capturing stdout.
 */

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

/* --------------------------------------------------------------- columns -- */

/**
 * Blank and zero rates per column. `blankPct` is null for an empty sample —
 * three of the five inspectors printed "blank 0 (NaN%)" instead.
 */
export function profileColumns(rows, names, { withBytes = false } = {}) {
  return names.map((name) => {
    const blank = rows.filter((r) => isBlank(r[name])).length;
    const zero = rows.filter((r) => !isBlank(r[name]) && Number(r[name]) === 0).length;
    const avgBytes = withBytes
      ? rows.reduce((s, r) => s + JSON.stringify(r[name] ?? "").length, 0) / (rows.length || 1)
      : null;
    return {
      name,
      blank,
      zero,
      blankPct: rows.length ? (100 * blank) / rows.length : null,
      avgBytes,
      /** A column requested but absent from every row is a wiring mistake. */
      absent: rows.length > 0 && rows.every((r) => !(name in r)),
    };
  });
}

export function formatCoverage(profile, { namePad = 26, withBytes = false } = {}) {
  return profile.map((c) => {
    const pct = c.blankPct === null ? "  n/a" : `${c.blankPct.toFixed(1).padStart(5)}%`;
    const bytes = withBytes && c.avgBytes !== null ? `  ${c.avgBytes.toFixed(1)} B` : "";
    const absent = c.absent ? "   ! never requested — absent from every row" : "";
    return `  ${String(c.name).padEnd(namePad)} blank ${String(c.blank).padStart(7)} (${pct})` +
      `  zero ${String(c.zero).padStart(7)}${bytes}${absent}`;
  });
}

/* -------------------------------------------------------------- distincts -- */

export function distinctCounts(rows, column, { blankLabel = "(blank)" } = {}) {
  const counts = new Map();
  for (const r of rows) {
    const k = isBlank(r[column]) ? blankLabel : String(r[column]).trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

export function formatDistinct(
  name,
  counts,
  { top = 30, minCardinality = 2, maxCardinality = 50 } = {},
) {
  if (counts.size < minCardinality || counts.size > maxCardinality) return null;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const lines = [`${name} — ${counts.size} distinct in sample:`];
  for (const [value, n] of rows.slice(0, top)) {
    lines.push(`  ${String(n).padStart(6)}  ${value}`);
  }
  if (counts.size > top) lines.push(`  ... and ${counts.size - top} more`);
  return lines;
}

/* ------------------------------------------------------------------ dates -- */

/**
 * Reject anything at or before this: Greene shipped 22,900 parcels claiming to
 * have sold on 1 January 1900 because its floor was `>=` rather than `>`.
 * Shared with saleDate() in parcelBuild.mjs so the report and the build cannot
 * disagree about what counts as a sale.
 */
export const PLACEHOLDER_DATE_FLOOR = "1900-01-01";
/** Franklin's sneakier second placeholder shape. */
export const SECOND_PLACEHOLDER = "1900-02-26";

export const findDateColumns = (fields, { namePattern = /DATE|DT$/i } = {}) =>
  (fields ?? [])
    .filter((f) => f.type === "esriFieldTypeDate" || namePattern.test(f.name))
    .map((f) => f.name);

/**
 * An empty string is not a date. `new Date(Number(""))` is new Date(0), which
 * is 1970-01-01 — a valid date that a `<= 1900-01-01` test does not catch, so
 * Delaware silently counted every blank sale date as a genuine 1970 conveyance
 * and dragged its reported range back to the epoch.
 */
export function profileDates(values) {
  const nonBlank = values.filter((v) => !isBlank(v));
  const iso = [];
  let unparsed = 0;
  for (const v of nonBlank) {
    const ms = typeof v === "number" ? v : Number(v);
    const d = Number.isFinite(ms) ? new Date(ms) : new Date(String(v));
    if (Number.isNaN(d.getTime())) {
      unparsed++;
      continue;
    }
    iso.push(d.toISOString().slice(0, 10));
  }
  iso.sort();
  return {
    nonBlank: nonBlank.length,
    parsed: iso.length,
    unparsed,
    min: iso[0] ?? null,
    max: iso[iso.length - 1] ?? null,
    ph1900: iso.filter((s) => s <= PLACEHOLDER_DATE_FLOOR).length,
    phEarly: iso.filter((s) => s > PLACEHOLDER_DATE_FLOOR && s < "1910-01-01").length,
    phEpoch: iso.filter((s) => s === "1970-01-01").length,
  };
}

export function formatDateProfile(column, p) {
  const lines = [];
  if (!p.parsed) {
    lines.push(`${column}: ${p.nonBlank.toLocaleString()} non-blank, none parsed as a date`);
    return lines;
  }
  lines.push(
    `${column}: ${p.nonBlank.toLocaleString()} non-blank, range ${p.min} .. ${p.max}` +
      (p.unparsed ? ` (${p.unparsed.toLocaleString()} unparsed)` : ""),
  );
  if (p.ph1900) {
    lines.push(
      `  ! ${p.ph1900.toLocaleString()} at or before ${PLACEHOLDER_DATE_FLOOR} — ` +
        `placeholders, not sales. Greene shipped 22,900 of these as real conveyances. Reject them.`,
    );
  }
  if (p.phEarly) {
    lines.push(
      `  ! ${p.phEarly.toLocaleString()} in 1900-1910 — check for Franklin's ` +
        `${SECOND_PLACEHOLDER} second-placeholder shape before trusting them`,
    );
  }
  if (p.phEpoch) {
    lines.push(`  ! ${p.phEpoch.toLocaleString()} are exactly 1970-01-01 — a zero epoch means "never sold"`);
  }
  if (!p.ph1900 && !p.phEarly && !p.phEpoch) lines.push("  no placeholder shapes detected");
  return lines;
}

/* --------------------------------------------------------- placeholders --- */

/**
 * The symmetric check to profileDates that no inspector had: a sentinel owner
 * name is as much a placeholder as a sentinel date, and just as silent.
 */
export const OWNER_SENTINELS = [
  "UNKNOWN",
  "N/A",
  "NA",
  "NONE",
  "NOT AVAILABLE",
  "NO NAME",
  "OWNER UNKNOWN",
  "CURRENT OWNER",
  "TAXPAYER",
  ".",
  "-",
];

export function detectPlaceholderValues(rows, column, sentinels = OWNER_SENTINELS) {
  const want = new Set(sentinels.map((s) => s.toUpperCase()));
  const hits = new Map();
  for (const r of rows) {
    const v = r[column];
    if (isBlank(v)) continue;
    const k = String(v).trim().toUpperCase();
    if (want.has(k)) hits.set(k, (hits.get(k) || 0) + 1);
  }
  const total = [...hits.values()].reduce((a, b) => a + b, 0);
  return { hits, total, pct: rows.length ? (100 * total) / rows.length : 0 };
}

/* ----------------------------------------------------------- value columns -- */

/**
 * The union of the two regexes that drifted apart: Cuyahoga's had TAX_ but not
 * IMPR, Hamilton's and Montgomery's had IMPR but not TAX_, so each missed a
 * column shape the other caught. Neither omission looked deliberate.
 */
export const VALUE_COL_RE =
  /VAL|MKT|MARKET|APPR|ASSD|ASSESS|TAXABLE|TAX_|LAND|BLDG|BUILDING|IMPR|TOT/i;

export function valueColumnCandidates(rows, names, { pattern = VALUE_COL_RE, minPopulated = 0.3 } = {}) {
  return names.filter(
    (n) =>
      pattern.test(n) &&
      rows.filter((r) => !isBlank(r[n]) && Number.isFinite(Number(r[n]))).length >=
        rows.length * minPopulated,
  );
}

/** Upper median of b/a over the rows where both are present and a is non-zero. */
export function ratioMedian(rows, a, b) {
  const ratios = rows
    .filter((r) => !isBlank(r[a]) && !isBlank(r[b]) && Number(r[a]) > 0)
    .map((r) => Number(r[b]) / Number(r[a]))
    .filter((v) => Number.isFinite(v))
    .sort((x, y) => x - y);
  if (!ratios.length) return null;
  return { median: ratios[Math.floor(ratios.length / 2)], n: ratios.length };
}

/**
 * The 0.3500 test. ORC 5713.03 fixes the assessed ratio at 35%, so a pair whose
 * median lands there names itself: the denominator is market, the numerator is
 * assessed. A median near 1.0 means the column is a 100% figure and assessed
 * has to be DERIVED — 35% of land and 35% of improvement separately, each
 * rounded to the nearest $10, then summed. Lorain proved that summing first is
 * wrong.
 */
export function classifyRatio(med, { target = 0.35, tol = 0.005 } = {}) {
  if (med === null || med === undefined) return "no overlapping rows";
  if (Math.abs(med - target) <= tol) return `≈ ${target} — assessed over market, as ORC 5713.03 requires`;
  if (med >= 0.995 && med <= 1.005) return "≈ 1.0 — the same figure, or a 100% column that must be derived";
  if (med < target) return `below ${target} — a partial or exempted figure, not a straight assessed ratio`;
  return `above ${target} — the numerator is not an assessed value`;
}

export function pairwiseRatioReport(rows, cols, { target = 0.35, tol = 0.005 } = {}) {
  const lines = [];
  for (const a of cols) {
    for (const b of cols) {
      if (a === b) continue;
      const r = ratioMedian(rows, a, b);
      if (!r) continue;
      // Report each pair one way round only.
      if (r.median >= 1.001 || r.median < 0.05) continue;
      lines.push(
        `  ${b} / ${a}: median ${r.median.toFixed(4)} over ${r.n.toLocaleString()} rows` +
          `  — ${classifyRatio(r.median, { target, tol })}`,
      );
    }
  }
  return lines.length ? lines : ["  none — CAMA is not in this layer"];
}
