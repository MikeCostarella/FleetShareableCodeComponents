/**
 * Ohio State Plane, in one place (Statehouse #10).
 *
 * THE ZONE IS THE MOST DANGEROUS CONSTANT IN THE FLEET
 * ---------------------------------------------------
 * Lorain and Delaware are Ohio NORTH (EPSG:3734); Franklin is SOUTH
 * (EPSG:3735). Carrying the wrong zone forward does not throw — it puts every
 * parcel in the county several miles from where it belongs, or skews every
 * computed area by a few percent, silently.
 *
 * AND THE SERVICE'S METADATA CANNOT SETTLE IT. Delaware's layer reports
 * `wkid 102722` — Esri's code for Ohio SOUTH — alongside `latestWkid 3734`,
 * which is EPSG's code for Ohio NORTH. The two disagree with each other in the
 * same response. The extent settles it; the label does not. Verify against
 * coordinates, never against the name.
 *
 * `+x_0=600000` is not a shortcut: PROJ takes the false easting in METRES even
 * when the coordinate system's units are feet, and 600,000 m is exactly the
 * 1,968,500 ftUS the EPSG definition specifies. Verified by round-tripping a
 * layer's own extreme coordinate onto its county's north-east corner.
 *
 * MEASURE IN FEET, NOT DEGREES. A shoelace area computed on raw longitude and
 * latitude is off by roughly cos(latitude) — about 24% at 40.3 N — and Web
 * Mercator inflates Cuyahoga's areas by ~78%.
 */

export const SQFT_PER_ACRE = 43_560;

export const OHIO_NORTH =
  "+proj=lcc +lat_0=39.6666666666667 +lon_0=-82.5 +lat_1=41.7 +lat_2=40.4333333333333 " +
  "+x_0=600000 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs";

export const OHIO_SOUTH =
  "+proj=lcc +lat_0=38 +lon_0=-82.5 +lat_1=40.0333333333333 +lat_2=38.7333333333333 " +
  "+x_0=600000 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs";

export const ZONES = {
  north: { epsg: "EPSG:3734", def: OHIO_NORTH, name: "NAD83 / Ohio North (ftUS)" },
  south: { epsg: "EPSG:3735", def: OHIO_SOUTH, name: "NAD83 / Ohio South (ftUS)" },
};

export function zoneDef(zone) {
  const key = String(zone).toLowerCase();
  const found =
    ZONES[key] ??
    Object.values(ZONES).find((z) => z.epsg.toLowerCase() === key || z.epsg.endsWith(String(zone)));
  if (!found) {
    throw new Error(
      `unknown Ohio State Plane zone ${JSON.stringify(zone)} — use "north" (3734) or "south" (3735)`,
    );
  }
  return found;
}

/**
 * Build the transform pair from an injected proj4, so this module imports
 * cleanly in a repo that does not carry proj4 as a devDependency.
 */
export function makeStatePlane(proj4, zone) {
  const z = zoneDef(zone);
  const t = proj4(z.def, "EPSG:4326");
  return {
    ...z,
    /** State Plane feet -> [lon, lat] degrees. */
    toWgs84: ([x, y]) => t.forward([x, y]),
    /** [lon, lat] degrees -> State Plane feet. */
    fromWgs84: ([lon, lat]) => t.inverse([lon, lat]),
  };
}

/** Convenience for scripts that do carry proj4. */
export async function ohioStatePlane(zone) {
  const { default: proj4 } = await import("proj4");
  return makeStatePlane(proj4, zone);
}

export const sqftToAcres = (sqft) => sqft / SQFT_PER_ACRE;
