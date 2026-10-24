// Per-county configuration for this app instance.
//
// Written by Statehouse/scripts/new-county-voters.py from
// {{COUNTY_SQUASHED}}CountyParcels/react-app/src/config/county.ts, trimmed to the
// values a voters map uses: the parcel valuation and statewide-service
// settings have no meaning here. This is the one source file that is not
// shared (FleetShareableCodeComponents/voters-core never writes it).
//
// COUNTY_FIPS IS NOT COSMETIC. The vendored data/boundaries.ts queries the
// Census TIGERweb county-subdivision layer with it to build the county mask,
// and that mask is both the townships overlay and the clip that keeps
// neighbouring cities off the map. Point it at the wrong county and the app
// renders that county's townships under this county's name.

/** County this build serves. */
export const COUNTY_NAME = "{{COUNTY}}";

/** 5-digit FIPS code for the county (from {{COUNTY_SQUASHED}}CountyParcels). */
export const COUNTY_FIPS = "{{FIPS}}";

/**
 * This county's extent, [xmin,ymin,xmax,ymax] in WGS84 degrees. Same box as
 * {{COUNTY_SQUASHED}}CountyParcels.
 *
 * Scopes the incorporated-places query, and filters boundary features when the
 * county mask fails. It does NOT filter voters.
 */
export const AREA_BBOX = {{BBOX}};

/** Initial map view. Same centre {{COUNTY_SQUASHED}}CountyParcels opens on. */
export const MAP_CENTER: [number, number] = {{CENTER}};

/** Zoom the map opens at. */
export const MAP_ZOOM = {{ZOOM}};
