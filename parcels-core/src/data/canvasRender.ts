// Fast canvas-rendering helpers, ported from the prototype's inline approach.
//
// The speed at ~100k points comes from three things, none of which involve
// creating per-point objects:
//   1. Inline Mercator projection (no per-point map.project() calls).
//   2. Points held in parallel typed arrays (Float32/Uint8), not objects.
//   3. Viewport culling + drawing batched by color in a few canvas paths.
//
// Clusters for low zooms are precomputed once at load into a per-zoom pyramid,
// so panning/zooming only reads precomputed arrays instead of re-clustering.

import type { Parcel } from "../types/point";

/** Zoom at/above which we draw individual points instead of clusters. */
export const UNCLUSTERED_ZOOM = 16;
/** Lowest zoom we build a cluster level for. */
export const MIN_CLUSTER_ZOOM = 9;

/** Parallel typed-array form of the points — the hot data for drawing. */
export interface PackedPoints {
  n: number;
  lats: Float32Array;
  lons: Float32Array;
  types: Uint8Array;
}

/** One precomputed cluster level. */
export interface ClusterLevel {
  lats: Float32Array;
  lons: Float32Array;
  counts: Uint32Array;
  dominant: Uint8Array; // dominant structure-type code in each cluster
}

export type ClusterPyramid = Record<number, ClusterLevel>;

/** Pack the loaded points into parallel typed arrays once. */
export function packPoints(points: Parcel[]): PackedPoints {
  const n = points.length;
  const lats = new Float32Array(n);
  const lons = new Float32Array(n);
  const types = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    lats[i] = points[i].lat;
    lons[i] = points[i].lon;
    types[i] = points[i].type;
  }
  return { n, lats, lons, types };
}

/** Inline Web-Mercator projection to pixel space at a given zoom. */
export function projectLatLon(lat: number, lon: number, zoom: number): [number, number] {
  const scale = 256 * Math.pow(2, zoom);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = scale * (lon / 360 + 0.5);
  const y = scale * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI));
  return [x, y];
}

/** Cluster icon radius by child count (ported from prototype). */
export function clusterRadius(count: number): number {
  if (count < 10) return 16;
  if (count < 100) return 20;
  if (count < 1000) return 26;
  if (count < 10000) return 32;
  return 38;
}

/** Individual point radius by zoom (ported from prototype). */
export function pointRadius(z: number): number {
  if (z <= 16) return 8;
  if (z === 17) return 11;
  if (z === 18) return 14;
  return 16;
}

/**
 * Build the cluster pyramid for zooms [MIN_CLUSTER_ZOOM, UNCLUSTERED_ZOOM).
 *
 * Grid clustering, matching the prototype: at each zoom, snap every point to a
 * ~60px pixel cell and aggregate. Dominant type = most common type in the cell.
 * Runs once on load (a few hundred ms for 100k points) and is reused for all
 * panning/zooming.
 */
export function buildClusterPyramid(pk: PackedPoints): ClusterPyramid {
  const CELL_PX = 60;
  const pyramid: ClusterPyramid = {};

  for (let z = MIN_CLUSTER_ZOOM; z < UNCLUSTERED_ZOOM; z++) {
    // cell key -> { sumX, sumY, count, typeCounts }
    const cells = new Map<
      number,
      { sx: number; sy: number; c: number; types: Record<number, number> }
    >();
    const scale = 256 * Math.pow(2, z);

    for (let i = 0; i < pk.n; i++) {
      const lat = pk.lats[i];
      const lon = pk.lons[i];
      const sinLat = Math.sin((lat * Math.PI) / 180);
      const px = scale * (lon / 360 + 0.5);
      const py = scale * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI));
      const cx = Math.floor(px / CELL_PX);
      const cy = Math.floor(py / CELL_PX);
      // Combine cell coords into one numeric key (cy is bounded well under 2^20).
      const key = cx * 4194304 + cy;
      let cell = cells.get(key);
      if (!cell) {
        cell = { sx: 0, sy: 0, c: 0, types: {} };
        cells.set(key, cell);
      }
      cell.sx += lat;
      cell.sy += lon;
      cell.c += 1;
      const t = pk.types[i];
      cell.types[t] = (cell.types[t] ?? 0) + 1;
    }

    const m = cells.size;
    const lats = new Float32Array(m);
    const lons = new Float32Array(m);
    const counts = new Uint32Array(m);
    const dominant = new Uint8Array(m);
    let idx = 0;
    for (const cell of cells.values()) {
      lats[idx] = cell.sx / cell.c;
      lons[idx] = cell.sy / cell.c;
      counts[idx] = cell.c;
      let bestType = 0;
      let bestN = -1;
      for (const k in cell.types) {
        if (cell.types[k] > bestN) {
          bestN = cell.types[k];
          bestType = Number(k);
        }
      }
      dominant[idx] = bestType;
      idx++;
    }
    pyramid[z] = { lats, lons, counts, dominant };
  }

  return pyramid;
}
