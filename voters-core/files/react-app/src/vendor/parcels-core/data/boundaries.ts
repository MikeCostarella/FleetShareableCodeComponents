import type { Feature, FeatureCollection } from "geojson";
import { AREA_BBOX, COUNTY_FIPS } from "../../../config/county";
import { pointInGeometry } from "./pointInPolygon";

/**
 * Boundary layers fetched live from the U.S. Census TIGERweb ArcGIS server.
 * Layer 4 = Incorporated Places (cities/villages); Layer 1 = County
 * Subdivisions (townships). Both expose a NAME field and geoJSON output.
 *
 * SCOPING — THIS HAS BEEN WRONG TWICE, IN TWO DIFFERENT WAYS.
 *
 * Attempt 1 (all counties, original): one padded envelope and
 * `esriSpatialRelIntersects` for both layers. That returns every unit whose
 * polygon *touches* the box, and returns it WHOLE, so a few kilometres of
 * padding pulled in every neighbouring township in full. On Clinton, where it
 * was first caught, the result covered six counties.
 *
 * Attempt 2 (Clinton onward): townships filtered exactly by county FIPS —
 * correct, and still what happens below — and places kept on a spatial query
 * but against the county's true extent with no padding. That fixed Clinton and
 * Miami. IT DID NOT FIX LORAIN, and the reason is worth writing down.
 *
 * A BOUNDING BOX IS ONLY A GOOD PROXY FOR A COUNTY IF THE COUNTY IS A RECTANGLE.
 *
 * Lorain's eastern boundary is a staircase. Up on the lakeshore it runs at
 * about -81.96, between Avon Lake and Bay Village. Down in Columbia Township,
 * 25 miles south, it runs at about -81.87. The county's bounding box has to
 * span both, so its xmax is -81.877 — and that means the northern half of the
 * box contains a band of CUYAHOGA County several miles wide.
 *
 * Every incorporated place in that band intersected the envelope and came back
 * whole: Bay Village, Westlake, North Olmsted, Olmsted Falls, Berea,
 * Strongsville, and Cleveland itself, whose airport panhandle reaches far
 * enough west to qualify. The map drew metropolitan Cleveland in orange.
 *
 * THE FIX: TEST AGAINST THE COUNTY, NOT AGAINST A BOX AROUND IT.
 *
 * TIGER's county-subdivision layer exhaustively tiles a county — the
 * subdivisions partition it with no gaps and no overlap — and we already fetch
 * exactly that, filtered exactly by FIPS, for the townships layer. So it is
 * already the county's true shape, at full detail, for free. Places are now
 * kept only if they actually fall inside it.
 *
 * The envelope query is still sent, but only as a cheap server-side prefilter
 * so we are not asking TIGERweb for every incorporated place in the country.
 * The envelope decides what to download; the polygon decides what to draw.
 *
 * WHAT "INSIDE" MEANS HERE, and why it is not just a centroid test.
 *
 * A place is kept if its Census internal point falls in the county. That point
 * is guaranteed by the Census to lie within the place's own polygon, which a
 * mathematical centroid is not — a centroid can land outside a crescent-shaped
 * city or in a lake.
 *
 * But an internal-point test alone assigns each place to exactly ONE county,
 * which is wrong for a city that genuinely straddles the line. Vermilion is
 * the case in point on Lorain: it sits across the Erie/Lorain line, its
 * internal point is on the Erie side, and a strict internal-point rule would
 * erase a city that really is partly there. Delaware has the same situation
 * with Westerville, Columbus and Dublin, all of which cross the Franklin line
 * northward into this county. So a place also survives if a real share of
 * its outline is inside — see VERTEX_SHARE below.
 */
const TIGER_BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";

export interface BoundaryLayerDef {
  id: "municipalities" | "townships";
  label: string;
  layerId: number;
  /** Stroke color for the outline. */
  color: string;
  dashArray?: string;
}

export const BOUNDARY_LAYERS: BoundaryLayerDef[] = [
  { id: "municipalities", label: "Municipalities", layerId: 4, color: "#FF8F00", dashArray: "8,5" },
  { id: "townships", label: "Townships", layerId: 1, color: "#607d8b" },
];

// COUNTY_FIPS is "SSCCC" — state then county, e.g. "39049" for Franklin.
const STATE_FIPS = COUNTY_FIPS.slice(0, 2);
const COUNTY_ONLY_FIPS = COUNTY_FIPS.slice(2);

/**
 * The county's bounding box in WGS84. Used ONLY as a prefilter on the places
 * query, and as the degraded fallback if the county mask cannot be fetched.
 * It is deliberately not trusted for what gets drawn — see the scoping note.
 *
 * Taken from the Delaware County Auditor's own parcel layer extent, inverse
 * projected from Ohio State Plane North (EPSG:3734).
 *
 * Delaware is close to rectangular, so a box is a better fit here than it was
 * on Lorain. That is not a reason to trust one: the county's entire southern
 * line is the top of the Columbus metro, and Westerville, Columbus and Dublin
 * all straddle or abut it. The places query is still clipped against the real
 * county polygon.
 */
// AREA_BBOX lives in config/county.ts — it is this county's extent.

/**
 * A straddling place is kept when at least this share of its outline vertices,
 * and at least this many of them, fall inside the county.
 *
 * Both conditions matter, and they guard against opposite mistakes. The share
 * alone would keep a tiny village just over the line whose handful of vertices
 * happen to test inside. The count alone would keep a large city that merely
 * SHARES a border with the county — Strongsville runs along Lorain's east line
 * for miles, so it has many vertices sitting exactly on the boundary, and
 * ray-casting classifies a point on the edge unpredictably. Requiring a real
 * fraction of the whole outline, not just a lot of points, is what separates
 * "partly in this county" from "adjacent to this county".
 */
const VERTEX_SHARE = 0.1;
const VERTEX_MIN = 8;

/** Every [lon,lat] vertex of a Polygon/MultiPolygon, outer rings and holes. */
function vertices(f: Feature): number[][] {
  const g = f.geometry;
  if (!g) return [];
  const polys: number[][][][] =
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [];
  const out: number[][] = [];
  for (const poly of polys) for (const ring of poly) out.push(...ring);
  return out;
}

/** True when the point lies inside any feature of the mask. */
function insideMask(lon: number, lat: number, mask: FeatureCollection): boolean {
  for (const f of mask.features as Feature[]) {
    if (pointInGeometry(lon, lat, f.geometry)) return true;
  }
  return false;
}

/** Run one TIGERweb query and return its FeatureCollection, or null. */
async function query(layerId: number, params: URLSearchParams): Promise<FeatureCollection | null> {
  try {
    const res = await fetch(`${TIGER_BASE}/${layerId}/query?${params.toString()}`);
    const data = await res.json();
    // ArcGIS returns query errors as HTTP 200 with an error body, so `res.ok`
    // is not a sufficient guard — check the payload shape instead.
    if (!data || !Array.isArray(data.features)) return null;
    return data as FeatureCollection;
  } catch {
    return null;
  }
}

/**
 * The county's true shape: its county subdivisions, filtered exactly by FIPS.
 *
 * Memoized because it is both the townships layer the user can toggle on and
 * the mask the places layer is clipped against, and there is no reason to ask
 * TIGERweb for it twice. The promise is cached rather than the result, so
 * concurrent callers share one request instead of racing.
 *
 * A FAILED FETCH IS NOT CACHED, and that distinction matters more than it
 * looks. The first version memoized the promise unconditionally, so a single
 * transient failure — TIGERweb rate-limiting, a dropped connection, a slow
 * response — resolved to null and then STAYED null for the life of the page.
 * Every later call got the cached null back without another request, the
 * townships layer drew nothing, and the places layer silently fell back to its
 * degraded bounding-box mode. The map simply lost its boundaries mid-session
 * with nothing in the console to say why.
 *
 * Caching a success is an optimisation. Caching a failure is a decision that
 * the network will never work again.
 */
let countyMask: Promise<FeatureCollection | null> | null = null;

function fetchCountyMask(): Promise<FeatureCollection | null> {
  if (!countyMask) {
    countyMask = query(
      1,
      new URLSearchParams({
        // Exact: a county subdivision belongs to exactly one county.
        where: `STATE='${STATE_FIPS}' AND COUNTY='${COUNTY_ONLY_FIPS}'`,
        outFields: "NAME",
        outSR: "4326",
        returnGeometry: "true",
        f: "geoJSON",
      }),
    ).then((result) => {
      if (!result) {
        // Forget the attempt so the next caller retries rather than inheriting
        // this failure for the rest of the session.
        countyMask = null;
        if (import.meta.env.DEV) {
          console.warn(
            "[boundaries] county mask fetch failed — boundaries will not draw " +
              "this time. The next attempt will retry rather than reuse this.",
          );
        }
      }
      return result;
    });
  }
  return countyMask;
}

/**
 * Fetch one boundary layer as GeoJSON, scoped to this county.
 * Returns null on any failure (caller treats null as "show nothing").
 */
export async function fetchBoundary(
  def: BoundaryLayerDef,
): Promise<FeatureCollection | null> {
  if (def.id === "townships") return fetchCountyMask();

  // Places are not county-scoped, so the server can only narrow, not decide.
  const places = await query(
    def.layerId,
    new URLSearchParams({
      where: `STATE='${STATE_FIPS}'`,
      geometry: `${AREA_BBOX.xmin},${AREA_BBOX.ymin},${AREA_BBOX.xmax},${AREA_BBOX.ymax}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      // INTPTLAT/INTPTLON are the Census internal point: guaranteed to lie
      // within the place's own polygon, unlike a computed centroid.
      outFields: "NAME,INTPTLAT,INTPTLON",
      outSR: "4326",
      returnGeometry: "true",
      f: "geoJSON",
    }),
  );
  if (!places) return null;

  const mask = await fetchCountyMask();

  const keep = (f: Feature): boolean => {
    const p = (f.properties ?? {}) as { INTPTLAT?: string; INTPTLON?: string };
    const lat = Number(p.INTPTLAT);
    const lon = Number(p.INTPTLON);
    const haveInternalPoint = Number.isFinite(lat) && Number.isFinite(lon);

    if (!mask) {
      // Degraded mode: the county mask failed. Fall back to testing the
      // internal point against the bounding box. Still far better than
      // drawing every polygon that clipped the box, which is what produced
      // metropolitan Cleveland.
      if (!haveInternalPoint) return false;
      return (
        lon >= AREA_BBOX.xmin &&
        lon <= AREA_BBOX.xmax &&
        lat >= AREA_BBOX.ymin &&
        lat <= AREA_BBOX.ymax
      );
    }

    if (haveInternalPoint && insideMask(lon, lat, mask)) return true;

    // Straddler check: is a real share of the outline actually in the county?
    const vs = vertices(f);
    if (vs.length === 0) return false;
    let inside = 0;
    for (const [vlon, vlat] of vs) {
      if (insideMask(vlon, vlat, mask)) inside++;
    }
    return inside >= VERTEX_MIN && inside / vs.length >= VERTEX_SHARE;
  };

  const kept = (places.features as Feature[]).filter(keep);

  if (import.meta.env.DEV) {
    const nameOf = (f: Feature) => (f.properties as { NAME?: string })?.NAME ?? "?";
    const dropped = (places.features as Feature[]).filter((f) => !keep(f)).map(nameOf);
    console.info(
      `[boundaries] places: ${places.features.length} returned, ${kept.length} kept` +
        `${mask ? "" : " (NO COUNTY MASK — bbox fallback)"}\n` +
        `  kept:    ${kept.map(nameOf).sort().join(", ") || "(none)"}\n` +
        `  dropped: ${dropped.sort().join(", ") || "(none)"}`,
    );
  }

  return { ...places, features: kept } as FeatureCollection;
}
