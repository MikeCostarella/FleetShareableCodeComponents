// TEST HARNESS - not a county app.
//
// A verbatim copy of FranklinCountyParcels/react-app/src/config/county.ts, taken
// 27 Sep 2026 when this repo became parcels-core's source of truth. The library
// suites were written and last passed inside Franklin, so they run against
// Franklin's constants here (see vitest.config.ts for the alias). Change a value
// only when a test genuinely needs a different county, and say so here.
//
// ---------------------------------------------------------------------------

// Per-county configuration for this app instance.
//
// COUNTY_FIPS IS NOT COSMETIC. src/data/boundaries.ts queries the Census
// TIGERweb county-subdivision layer with it to build the county mask, and that
// mask is both the townships overlay and the clip that keeps neighbouring
// cities off the map. Leave it pointing at the previous county and the app
// renders that county's townships under this county's name — which is exactly
// what happened here before this file was written.
//
// FRANKLIN'S SOURCE IS ONE ARCGIS LAYER
//
//   https://gis.franklincountyohio.gov/hosting/rest/services
//     /ParcelFeatures/Parcel_Features/MapServer/0
//
// 494,525 parcels, the largest county in this series. The layer carries the
// record, and — unusually — the Auditor's own parcel centroids as plain
// X_COORD / Y_COORD attributes on 87.5% of parcels. That means the harvest can
// run with returnGeometry=false and fetch polygons only for the remaining
// eighth, which at this size is the difference between a long job and an
// unusable one. ACRES is populated on every parcel, so acreage needs no
// geometry at all.
//
// FRANKLIN IS A SOUTH-ZONE COUNTY
//
// EPSG:3735, Ohio State Plane South — back to the zone Clark, Greene, Clinton
// and Miami used, after Lorain and Delaware were both NORTH (EPSG:3734).
// Carrying the North zone forward would not throw; it would put every parcel
// several miles from where it belongs. Verified by round-tripping the layer's
// own extreme coordinate onto the county's north-east corner.
//
// THERE IS NO MUNICIPALITY OR TOWNSHIP COLUMN
//
// CVTTXDSCRP — the city/village/township tax description — is the entire
// jurisdiction mapping, and it mixes municipality, township and school district
// into one string: "CITY OF COLUMBUS", "COLUMBUS-SOUTHWESTERN CSD",
// "CITY OF DUBLIN-WASH TWP-DUBLIN", "PLAIN TWP-NEW ALBANY CORP". See
// scripts/build-parcels.mjs for how that is decomposed, and do not trust a
// regex over it without checking the result against the county's own list of
// municipalities.

/** County this build serves. */
export const COUNTY_NAME = "Franklin";

/** 5-digit FIPS code for the county. */
export const COUNTY_FIPS = "39049";

/**
 * True when parcels.json carries land / building / total market and total
 * assessed values.
 *
 * Franklin publishes LNDVALUEBASE / BLDVALUEBASE / TOTVALUEBASE and NO
 * ASSESSED COLUMN AT ALL — CNTTXBLVAL and ASSDVALYRCG are both 100% blank in
 * the layer. Assessed is therefore derived at 35% of market under ORC 5713.03,
 * the way Lorain's was, rather than read the way Delaware's was.
 */
export const HAS_VALUATION = true;

/**
 * This county's extent, [xmin,ymin,xmax,ymax] in WGS84 degrees.
 *
 * Used two ways by the library: to scope the incorporated-places query, and as
 * the sanity check that every parcel pin lands inside the county. It lives here
 * rather than in the library because it IS the county — a shared default would
 * silently draw and validate against the wrong place.
 *
 * Franklin's box is deliberately generous at the north: the county line is the
 * top of the Columbus metro, and Westerville, Columbus and Dublin all straddle
 * or abut it. Places are still clipped against the real county polygon.
 */
export const AREA_BBOX = { xmin: -83.2049, ymin: 39.8088, xmax: -82.7712, ymax: 40.1573 };

/**
 * How this county's parcel number must be written when querying the statewide
 * parcel service's `LocalParcelID` field: `"as-stored"` or `"stripped"` - or
 * `"not-applicable"` for the 35 counties that never query that service.
 *
 * VERIFIED FOR FRANKLIN, 6 August 2026, and it is "as-stored":
 *
 *   LocalParcelID='232-000007'  -> 1 feature
 *   LocalParcelID='232000007'   -> 0 features
 *
 * There is no fleet-wide answer. The statewide service holds each county's ID
 * in that county's own format — Franklin's carry punctuation, Logan's
 * (`170911622000000`) and Cuyahoga's (`13811037`) do not. A wrong value here
 * does not throw: the query returns nothing and the detail dialog reports "no
 * additional live record", which is indistinguishable from a parcel that
 * genuinely has none. Franklin shipped exactly that until this was checked.
 *
 * Settle it with one query per county before setting this. Do not infer it
 * from what the parcel numbers look like — three of four counties suspected
 * that way turned out to be wrong.
 *
 * NOTE this is only about the server-side WHERE clause. The client-side
 * polygon join normalises BOTH sides through `stateParcelKey` and is unaffected
 * — normalising both sides of a join is safe; normalising one side of a query
 * is not.
 */
export const STATE_PARCEL_KEY: "as-stored" | "stripped" | "not-applicable" | "dashed" =
  "as-stored";
