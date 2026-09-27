/**
 * The end-of-run sanity checks every harvest and inspector prints
 * (Statehouse #10, #17).
 *
 * These are the cheap checks that catch a wrong projection, a wrong zone or a
 * wrong value column — none of which throw. "Every pin must land inside the
 * county. One that does not means the projection is wrong, not that a parcel
 * moved."
 */
import { writeFileSync } from "node:fs";

/**
 * Upper median — the same convention as medianAssessedRatio in parcelBuild.mjs.
 * Keep them identical: a report and a build that disagree about the median are
 * worse than either being wrong alone.
 */
export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

export function pinCoverage(records, { latKey = "lat" } = {}) {
  const total = records.length;
  const withPin = records.filter((r) => typeof r[latKey] === "number").length;
  return { total, withPin, pct: total ? (100 * withPin) / total : 0 };
}

/**
 * Pins outside the county envelope, and how far outside the worst one is.
 *
 * WHY THERE IS A TOLERANCE
 * ------------------------
 * A county bbox is a rectangle around a shape that is not one, and a parcel on
 * the county line legitimately sits outside it. Franklin's box flagged 4,012
 * real parcels — Pleasant Township, the south-west corner — none further than
 * 0.05 degrees out. The constant is documented as "deliberately generous at
 * the north"; the overflow is at the west and south, which nobody checked
 * against the data.
 *
 * The check is worth keeping because the failure it guards is enormous: the
 * wrong State Plane zone moves parcels TENS of miles, not one. So the alarm
 * takes a tolerance, and the count just outside the strict box stays available
 * as information rather than as a warning that cries wolf on every harvest.
 */
export function outsideBox(records, bbox, { latKey = "lat", lonKey = "lon", tolerance = 0 } = {}) {
  const box = {
    xmin: bbox.xmin - tolerance,
    xmax: bbox.xmax + tolerance,
    ymin: bbox.ymin - tolerance,
    ymax: bbox.ymax + tolerance,
  };
  let count = 0;
  let worst = 0;
  for (const r of records) {
    const lat = r[latKey];
    const lon = r[lonKey];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const d = Math.max(box.xmin - lon, lon - box.xmax, box.ymin - lat, lat - box.ymax);
    if (d > 0) {
      count++;
      if (d > worst) worst = d;
    }
  }
  return { count, worst };
}

/** Just the count, for callers that only want the alarm. */
export const strayPins = (records, bbox, opts = {}) => outsideBox(records, bbox, opts).count;

export const bboxWithin = (inner, outer) =>
  inner.xmin >= outer.xmin &&
  inner.xmax <= outer.xmax &&
  inner.ymin >= outer.ymin &&
  inner.ymax <= outer.ymax;

/**
 * Surface the cause a bare fetch error hides: ECONNREFUSED, ENOTFOUND and
 * friends live on `err.cause`, and `err.message` alone is just "fetch failed".
 */
export const explain = (e) =>
  e?.message + (e?.cause ? ` — ${e.cause.code ?? e.cause.message ?? String(e.cause)}` : "");

export const mb = (n, digits = 1) => `${(n / 1_048_576).toFixed(digits)} MB`;

/**
 * A report sink that both prints and accumulates, so the deliverable is a file
 * rather than a screenshot.
 */
export function createReport(path, { echo = console.log, write = writeFileSync } = {}) {
  const out = [];
  const say = (line = "") => {
    out.push(line);
    echo(line);
  };
  return {
    say,
    mb,
    get lines() {
      return [...out];
    },
    flush() {
      write(path, out.join("\n") + "\n", "utf8");
      echo(`\nWrote ${path}`);
      echo("Send that file rather than a screenshot.");
      return path;
    },
  };
}
