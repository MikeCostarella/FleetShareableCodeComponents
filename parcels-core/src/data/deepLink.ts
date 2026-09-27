/**
 * Deep links into a parcels app: `?q=<address or parcel #>&lat=<lat>&lon=<lon>`.
 *
 * The OhioCounties hub's "Find a parcel by address" box and the
 * OhioFleetAddressParcelSearchBrowserExtension open an app this way (parcels-core
 * 1.11.0). They geocode the address first, so they usually pass both:
 *
 * - `q`: the matched street address plus ZIP, e.g. "4761 WATERLOO RD, 44201".
 *   It runs through the app's normal search, so the parcel opens exactly as if
 *   it had been typed into the Search panel.
 * - `lat`/`lon`: the geocoder's point. It is used only when the text search
 *   finds nothing. Auditor addresses are not always postal ones, and the map
 *   should still land on the right spot.
 *
 * Either part may be absent. Anything malformed is ignored, not guessed at.
 */
export interface DeepLink {
  q: string;
  lat?: number;
  lon?: number;
}

/** Longest `q` honoured; anything longer is not an address. */
const MAX_Q = 200;

/** Parse a location search string ("?q=...") into a deep link, or null when there is none. */
export function readDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim().slice(0, MAX_Q);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const hasPoint =
    params.get("lat") !== null &&
    params.get("lon") !== null &&
    params.get("lat") !== "" &&
    params.get("lon") !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;
  if (!q && !hasPoint) return null;
  return hasPoint ? { q, lat, lon } : { q };
}

/** Build the query string for a deep link, e.g. for the hub and the extension. */
export function deepLinkSearch(link: DeepLink): string {
  const params = new URLSearchParams();
  if (link.q) params.set("q", link.q);
  if (link.lat !== undefined && link.lon !== undefined) {
    params.set("lat", link.lat.toFixed(6));
    params.set("lon", link.lon.toFixed(6));
  }
  const s = params.toString();
  return s ? "?" + s : "";
}
