/**
 * Pure ring geometry for the harvest pipeline, extracted from
 * fetch-parcels.mjs (Statehouse Sprint 1, issue #6) so it is importable and
 * unit-tested. This is the code where a winding-convention sign error once
 * produced 129 pins out of 101,088 with no error message.
 *
 * Issue #10 added signedArea, largestRing and reduceRingsMeasured, which
 * replace five divergent per-county centroid functions.
 */

/** Twice the signed shoelace area of a ring, in the ring's own units. */
export function shoelace(ring) {
  let signed = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    signed += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return signed;
}

/** Signed area of a ring, in the ring's own units squared. */
export const signedArea = (ring) => shoelace(ring) / 2;

/** Area-weighted centroid of a projected ring. */
export function ringCentroid(ring) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (a === 0) {
    const m = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return [m[0] / ring.length, m[1] / ring.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * The ring with the largest ABSOLUTE area, and that area.
 *
 * A parcel can be several disjoint pieces — a farm split by a road, a condo
 * with a detached garage lot. The pin goes on the LARGEST piece, because a pin
 * placed on the centroid of the whole set can land in the gap between pieces,
 * on someone else's land. Knox and Morrow summed every ring into one
 * accumulator and did exactly that.
 */
export function largestRing(rings) {
  let best = null;
  let bestArea = 0;
  for (const ring of rings ?? []) {
    if (!ring || ring.length < 3) continue;
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best ? { ring: best, area: bestArea } : null;
}

/**
 * Reduce a polygon to a pin, orientation-agnostically.
 *
 * Esri's documented convention is outer rings clockwise, holes
 * counter-clockwise, and Delaware's first harvest encoded that with the sign
 * backwards — classifying every ordinary outer ring as a hole and producing
 * 129 pins out of 101,088 without erroring. So this does not depend on the
 * convention at all: the pin goes on the ring with the largest ABSOLUTE area,
 * whichever way it winds. A convention that is only ever used to decide a sign
 * is a convention worth not depending on.
 */
export function reduceRings(rings) {
  const best = largestRing(rings);
  if (!best) return null;
  const [lon, lat] = ringCentroid(best.ring);
  return { lon, lat };
}

/**
 * Pin AND area, measured in a projected metric.
 *
 * `project` maps [lon, lat] degrees to plane coordinates (feet). The ring is
 * selected and the centroid taken in the SAME metric, then inverted back to
 * degrees — three counties selected in feet but took the centroid in degrees,
 * which meant the pin and the area came from different coordinate systems.
 *
 * Pass `unproject` to get degrees back. Omit both to measure a ring that is
 * already projected.
 */
export function reduceRingsMeasured(
  rings,
  { project = null, unproject = null, sqftPerAcre = 43_560, precision = 6 } = {},
) {
  const planar = (rings ?? [])
    .filter((r) => r && r.length >= 3)
    .map((r) => (project ? r.map((p) => project([p[0], p[1]])) : r));
  const best = largestRing(planar);
  if (!best) return null;

  const [cx, cy] = ringCentroid(best.ring);
  const [lon, lat] = unproject ? unproject([cx, cy]) : [cx, cy];

  // Total area = |sum of signed ring areas| — holes subtract themselves,
  // whichever way they wind, so long as the sum is taken before the abs.
  const sqft = Math.abs(planar.reduce((sum, r) => sum + signedArea(r), 0));

  const round = (v) => Number(v.toFixed(precision));
  return {
    lon: round(lon),
    lat: round(lat),
    sqft,
    acres: Number((sqft / sqftPerAcre).toFixed(4)),
    absArea: best.area,
  };
}

/**
 * Two centroids closer than this are the same place — the same outline stored
 * twice — not two pieces of one parcel. Roughly a metre at Ohio's latitude.
 *
 * Montgomery used 1e-6, about 10 cm, while asking the service for
 * geometryPrecision=6 (~11 cm) — so ordinary rounding jitter classified a
 * duplicate outline as a separate piece and ADDED its acreage, doubling the
 * parcel. The threshold must be coarser than the precision requested.
 */
export const SAME_PLACE = 1e-5;

export const samePlace = (a, b, eps = SAME_PLACE) =>
  Math.abs(a.lat - b.lat) < eps && Math.abs(a.lon - b.lon) < eps;
