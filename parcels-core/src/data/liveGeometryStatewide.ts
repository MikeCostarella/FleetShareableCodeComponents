// Parcel polygons from the Ohio Statewide Parcels layer - what 53 counties use.
//
// Scoped to this county by COUNTY_WHERE. The join back to our parcel records
// goes through stateParcelKey, which normalises BOTH sides and is therefore
// safe whatever format the service holds - unlike the live lookup's WHERE
// clause, which normalises only ours and must match. Conflating those two was
// the bug that left Franklin's lookup dead.

import { COUNTY_WHERE, QUERY_BASE } from "./statewideLayer";
import type { ParcelFeatureCollection, ParcelGeometrySource } from "./liveGeometry";

/** What the statewide layer names its join key. */
export interface StatewideParcelFeatureProps {
  LocalParcelID: string | null;
}

export type { ParcelFeatureCollection, LatLngBounds } from "./liveGeometry";
export { stateParcelKey, stateQueryKey, COUNTY_WHERE } from "./statewideLayer";

/**
 * Fetch parcel polygons intersecting the given lat/lng bounds, as WGS84 GeoJSON.
 * Returns up to the layer's max (2000) features; callers gate this on a zoom
 * level where a viewport holds a manageable number of parcels.
 */
export const fetchParcelPolygons: ParcelGeometrySource<StatewideParcelFeatureProps> = async (bounds, signal) => {
  const envelope = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const params = new URLSearchParams({
    where: COUNTY_WHERE,
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "LocalParcelID",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "2000",
    f: "geojson",
  });

  const res = await fetch(`${QUERY_BASE}/query?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Parcel geometry request failed (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as ParcelFeatureCollection<StatewideParcelFeatureProps>;
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Unexpected parcel geometry response");
  }
  return data;
};
