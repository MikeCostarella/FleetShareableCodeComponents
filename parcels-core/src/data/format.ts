// Small display formatters shared across the parcel UI.

/** US dollar amount with no decimals, e.g. 198800 -> "$198,800". */
export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * Acreage, e.g. 2.9 -> "2.9 ac".
 *
 * Two decimals for anything from a hundredth of an acre up, four below that.
 *
 * The small-value case is not hypothetical. It was caught on Greene, which
 * carries 243 parcels between zero and half a hundredth of an acre — condo air
 * lots, right-of-way remnants, slivers left by a re-plat — and at two decimals
 * every one of them rendered "0 ac" while the Auditor's own summary page gave a
 * real figure. Parcel A02-0001-0020-0-0174-00 (City of Fairborn, E Dayton Dr)
 * is 0.0039 acres on both his page and in parcels.json, and it showed as
 * "0 ac" here. A further 631 parcels sat between 0.005 and 0.01 and were being
 * rounded to "0.01".
 *
 * Lorain is a denser, more urban county than Greene, with far more condominium
 * stock along the lakeshore, so the sliver population here should be larger
 * rather than smaller. The build reports the actual count.
 *
 * Reporting zero for land that exists is worse than an extra decimal place.
 */
export function acres(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} ac`;
}

/** A sale date string passthrough, blank-safe. */
export function saleDate(s: string | null | undefined): string {
  return s && s.trim() ? s : "—";
}
