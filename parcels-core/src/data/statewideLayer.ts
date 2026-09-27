// Everything about the one Ohio Statewide Parcels layer, in one place.
//
// Both statewide implementations import from here - the live lookup and the
// polygon source. They used to reach into parcelGeometry.ts for COUNTY_WHERE
// and stateQueryKey, which meant a county that queries its own service still
// had to carry, and configure, a statewide geometry file it never called.
//
// Layer: https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services
//        /OhioStatewidePacels_full_view/FeatureServer/0

import { COUNTY_NAME, STATE_PARCEL_KEY } from "../../../config/county";

const LAYER_PATH =
  "/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0";
const ABSOLUTE_BASE = `https://services2.arcgis.com${LAYER_PATH}`;

// Restrict every query to this county (the service is statewide). The name
// comes from config: a baked-in county name here would send every app in the
// fleet to look up one county's parcels.
export const COUNTY_WHERE = `County='${COUNTY_NAME}'`;

/**
 * Normalize a parcel number to the statewide service's `LocalParcelID` form:
 * alphanumerics only, uppercased. "E13-0001-0016-0-0017-00" becomes
 * "E13000100160001700". Use this on BOTH sides of any join between our records
 * and the statewide service — see the note at the top of this file.
 */
export function stateParcelKey(parcelNumber: string | null | undefined): string {
  return String(parcelNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Write a parcel number in the statewide service's dashed form,
 * `L##-#-###-##-###-##` (one letter, then 13 digits regrouped 2-1-3-2-3-2).
 *
 * Exists for the counties that store their numbers undashed while the
 * statewide service holds them dashed - the reverse of "stripped". Found in
 * Pickaway, whose key verification returned NO-MATCH in both original forms:
 * the service holds ~30,900 Pickaway parcels, dashed. Verified by query on
 * 9 August 2026 - 39 of a 40-parcel sample spread across parcels.json matched
 * after regrouping (the 40th is absent from the layer), and all 29,997 stored
 * numbers fit the letter-plus-13-digits shape, so the regrouping is total.
 *
 * Punctuation in the input is stripped before regrouping, so an already-dashed
 * number round-trips unchanged. Throws on any number that does not reduce to
 * one letter plus 13 digits: a county whose numbers do not all fit that shape
 * cannot declare `"dashed"`, and a silent pass-through here would recreate the
 * empty-result-set failure this file exists to prevent.
 */
export function dashedStateKey(parcelNumber: string | null | undefined): string {
  const bare = stateParcelKey(parcelNumber);
  if (!/^[A-Z]\d{13}$/.test(bare)) {
    throw new Error(
      `Cannot write "${String(parcelNumber ?? "")}" in the statewide dashed form: ` +
        "stripped of punctuation it is not one letter followed by 13 digits. " +
        'Re-verify this county\'s STATE_PARCEL_KEY before using "dashed" ' +
        "(see Statehouse design/state-parcel-key-results.md).",
    );
  }
  return [
    bare.slice(0, 3),
    bare.slice(3, 4),
    bare.slice(4, 7),
    bare.slice(7, 9),
    bare.slice(9, 12),
    bare.slice(12, 14),
  ].join("-");
}

/**
 * The value to put in a `LocalParcelID='...'` WHERE clause, per this county's
 * `STATE_PARCEL_KEY` setting.
 *
 * Distinct from `stateParcelKey` on purpose, and the distinction is the whole
 * bug: `stateParcelKey` normalises BOTH sides of the client-side polygon join,
 * which is safe whatever the service stores. A query normalises only OUR side,
 * so it has to match what the service actually holds — and that is per-county.
 *
 * Throws when the county's config says `"not-applicable"`. Every county
 * compiles this file, because the vendor tree is copied whole; only the
 * counties that actually wire a statewide implementation ever call this. If
 * one of them reaches here with the key unsettled, failing loudly is the
 * point — the alternative is the silent empty result set that shipped in four
 * counties before the August 2026 sweep, and which is indistinguishable from a
 * parcel that genuinely has no statewide record.
 */
export function stateQueryKey(parcelNumber: string | null | undefined): string {
  if (STATE_PARCEL_KEY === "not-applicable") {
    throw new Error(
      `${COUNTY_NAME} County's config declares STATE_PARCEL_KEY as "not-applicable", ` +
        "but something queried the statewide layer. Settle the key with one live " +
        "query per format (see Statehouse design/state-parcel-key-results.md) " +
        "before wiring liveLookupStatewide or liveGeometryStatewide.",
    );
  }
  if (STATE_PARCEL_KEY === "dashed") {
    return dashedStateKey(parcelNumber);
  }
  return STATE_PARCEL_KEY === "stripped"
    ? stateParcelKey(parcelNumber)
    : String(parcelNumber ?? "").trim();
}

// In dev we route through the Vite proxy (see vite.config.ts) to avoid any CORS
// friction; in production we hit the ArcGIS Online host directly (it serves
// permissive CORS headers for these public feature services).
export const QUERY_BASE = import.meta.env.DEV ? `/wcgis${LAYER_PATH}` : ABSOLUTE_BASE;
