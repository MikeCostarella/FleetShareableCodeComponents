// Parcel polygons served from a baked static file, rather than queried live.
//
// Twelve counties in this fleet publish lot shapes this way: a GeoJSON file in
// public/data, built once from the county's shapefile and reprojected to WGS84,
// fetched at runtime and filtered to the viewport in the browser. Ashland,
// Carroll, Coshocton, Erie, Huron, Morgan, Muskingum, Summit, Tuscarawas,
// Vinton, Wayne and Wood, as of 7 August 2026.
//
// THIS IS A DECISION THIS PROJECT MADE, NOT A COUNTY CHARACTERISTIC. Until
// 7 August 2026 all twelve still carried a vestigial `/ccgis` dev proxy to
// their county GIS server, referenced by nothing - what the app used before
// the conversion. Do not read "baked file" as "this county publishes no
// service"; every one of them has one.
//
// Extracted from twelve byte-identical copies. Once the join-property name was
// neutralised, all twelve normalised to one body - about 1,200 lines that only
// ever needed to exist once. The copies also carried a comment claiming the
// file is "~9.5 MB" in every county; actual sizes run 4.2 MB (Vinton) to
// 73.6 MB (Summit). Nothing here states a size, for that reason.

import type {
  LatLngBounds,
  ParcelFeatureCollection,
  ParcelGeometrySource,
} from "./liveGeometry";
import type { Feature, MultiPolygon, Polygon } from "geojson";

/** A baked feature, which may carry a precomputed bbox from the build step. */
type BakedFeature<P> = Feature<Polygon | MultiPolygon, P> & {
  bbox?: [number, number, number, number];
};

export interface BakedGeometryOptions {
  /**
   * File name under `public/data/`. Defaults to the fleet convention.
   * Resolved against `import.meta.env.BASE_URL`, so it is correct in dev and
   * under a GitHub Pages sub-path alike.
   */
  file?: string;
  /**
   * Cap on features returned for one viewport, so a zoomed-out map never tries
   * to draw a whole county. All twelve copies used 3000; that is the default.
   */
  maxFeatures?: number;
}

/** Feature bounding box [west, south, east, north]; prefers the baked one. */
function featureBBox<P>(f: BakedFeature<P>): [number, number, number, number] {
  if (f.bbox && f.bbox.length === 4) return f.bbox;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (a: unknown): void => {
    if (Array.isArray(a) && typeof a[0] === "number") {
      const x = a[0] as number;
      const y = a[1] as number;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    } else if (Array.isArray(a)) {
      a.forEach(walk);
    }
  };
  walk(f.geometry.coordinates);
  return [w, s, e, n];
}

/**
 * Build a `ParcelGeometrySource` backed by a static file.
 *
 * Call once at module scope in the county's `src/data/parcelGeometry.ts`: the
 * returned function closes over its own load-once cache, so calling this twice
 * would fetch the file twice. The county supplies only the property shape its
 * polygons carry - the join key is per-source and the library does not name it.
 *
 * The file is fetched on first use, not at import, so a county that never
 * switches the overlay on never pays for it. A failed load clears the in-flight
 * promise so the next call retries rather than caching the failure forever.
 */
export function bakedGeometrySource<P>(
  options: BakedGeometryOptions = {},
): ParcelGeometrySource<P> {
  const file = options.file ?? "parcel-polygons.json";
  const maxFeatures = options.maxFeatures ?? 3000;
  const url = `${import.meta.env.BASE_URL}data/${file}`;

  let cache: BakedFeature<P>[] | null = null;
  let loading: Promise<BakedFeature<P>[]> | null = null;

  function loadAll(signal?: AbortSignal): Promise<BakedFeature<P>[]> {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
      loading = fetch(url, { signal })
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `Parcel polygons request failed (${res.status} ${res.statusText})`,
            );
          }
          return res.json() as Promise<ParcelFeatureCollection<P>>;
        })
        .then((fc) => {
          cache = (fc.features as BakedFeature<P>[]) ?? [];
          return cache;
        })
        .catch((e) => {
          loading = null; // allow a retry on the next call
          throw e;
        });
    }
    return loading;
  }

  return async function fetchParcelPolygons(
    bounds: LatLngBounds,
    signal?: AbortSignal,
  ): Promise<ParcelFeatureCollection<P>> {
    const all = await loadAll(signal);
    const { west, south, east, north } = bounds;
    const hits: BakedFeature<P>[] = [];
    for (const f of all) {
      const [w, s, e, n] = featureBBox(f);
      if (e < west || w > east || n < south || s > north) continue; // bbox miss
      hits.push(f);
      if (hits.length >= maxFeatures) break;
    }
    return { type: "FeatureCollection", features: hits };
  };
}
