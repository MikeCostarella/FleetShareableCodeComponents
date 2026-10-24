import type { Feature, FeatureCollection, Geometry } from "geojson";

/** Ray-casting test for a point against a single ring of [lon,lat] pairs. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True if the point is inside the geometry (Polygon/MultiPolygon, honoring holes). */
export function pointInGeometry(
  lon: number,
  lat: number,
  geom: Geometry | null | undefined,
): boolean {
  if (!geom) return false;
  const polys: number[][][][] =
    geom.type === "Polygon"
      ? [geom.coordinates as number[][][]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as number[][][][])
        : [];
  for (const poly of polys) {
    if (!poly.length) continue;
    if (!pointInRing(lon, lat, poly[0])) continue; // not in outer ring
    let inHole = false;
    for (let r = 1; r < poly.length; r++) {
      if (pointInRing(lon, lat, poly[r])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Strip the type suffix a source already carries, then append " Township" for
 * townships. Mirrors townshipName() in scripts/build-parcels.mjs — change both
 * together or the map label and the parcel record will disagree.
 *
 * "Twp" is in the list because Franklin County has a township named
 * "Franklin Twp", to distinguish it from the City of Franklin. Without it the
 * label reads "Franklin Twp Township".
 */
function tidyName(name: string | undefined, isTownship: boolean): string {
  if (!name) return "Outside mapped area";
  let n = name.trim().replace(/\s+(city|village|town|township|twp\.?|borough|cdp)$/i, "");
  if (isTownship) n = `${n} Township`;
  return n;
}

/**
 * Find which jurisdiction a point falls in, given fetched municipality and
 * township FeatureCollections. Municipality wins over township (OH munis nest
 * inside township geography). Returns a display label or "Outside mapped area".
 */
export function jurisdictionAt(
  lon: number,
  lat: number,
  munis: FeatureCollection | null,
  twps: FeatureCollection | null,
): string {
  const check = (fc: FeatureCollection | null, isTownship: boolean): string | null => {
    if (!fc) return null;
    for (const f of fc.features as Feature[]) {
      if (pointInGeometry(lon, lat, f.geometry)) {
        return tidyName((f.properties as { NAME?: string })?.NAME, isTownship);
      }
    }
    return null;
  };
  return check(munis, false) ?? check(twps, true) ?? "Outside mapped area";
}
