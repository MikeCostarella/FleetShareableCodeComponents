// The polygon-source seam, the sibling of liveLookup.ts.
//
// Parcel polygons come from wherever the county publishes them. Counted across
// all 88 Parcels repos on 7 August 2026:
//
//   54 statewide layer      liveGeometryStatewide
//   22 own live service     the county writes its own against this contract
//   12 baked static file    bakedGeometrySource
//    0 none
//
// NO COUNTY PUBLISHES NO POLYGONS. An earlier count said twelve did; those
// twelve serve a baked file from public/data and were miscounted because the
// classifier looked for an http URL and a local file has none. A
// `liveGeometryNone` Null Object existed for that phantom population and was
// deleted on 7 August 2026 - it had never had a consumer. If a county with no
// polygons at all ever turns up, an empty FeatureCollection is a two-line
// county file; do not restore a library implementation for a population of
// zero.

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

/**
 * A polygon must carry something to join it back to a parcel, but WHAT that
 * property is called is per-source. The statewide layer calls it
 * `LocalParcelID`; Adams' county service returns `PARCEL_NUM` and normalises it
 * to `PIN`. So the collection is generic over the property shape and each
 * implementation declares its own - the same correction the record shape
 * needed when Adams turned out to share three fields out of fifteen.
 */
export type ParcelFeatureCollection<P = unknown> = FeatureCollection<
  Polygon | MultiPolygon,
  P
>;

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Fetch parcel polygons intersecting a lat/lng viewport, as WGS84 GeoJSON.
 *
 * An empty FeatureCollection is an ordinary answer - a viewport with no
 * parcels in it - not an error. Throws on network or server failure, the same
 * distinction liveLookup draws.
 */
export type ParcelGeometrySource<P = unknown> = (
  bounds: LatLngBounds,
  signal?: AbortSignal,
) => Promise<ParcelFeatureCollection<P>>;
