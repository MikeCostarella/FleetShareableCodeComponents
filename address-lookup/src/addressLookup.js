// address-lookup - from an Ohio street address to the right county parcels app.
//
// Shared by the OhioCounties hub ("Find a parcel by address") and the
// OhioFleetAddressParcelSearchBrowserExtension. Vendored into both from
// FleetShareableCodeComponents; edit it there, never in a vendored copy.
//
// Plain ES module with JSDoc types (addressLookup.d.ts for TypeScript), so the
// extension can load it with no build step.
//
// HOW IT RESOLVES AN ADDRESS
//
// The US Census Bureau geocoder turns a one-line address into matched
// addresses, each with a point and the county it falls in (5-digit FIPS). That
// beats a ZIP table: Ohio ZIPs cross county lines, and people type the postal
// city ("Atwater") where the Auditor records the township ("Randolph").
//
// The geocoder sends no CORS headers (checked 27 Sep 2026), so a web page
// cannot fetch() it. It does serve JSONP, which is what the hub uses. The
// extension fetch()es it from its service worker, which its host permission
// allows.
//
// The geocoder will not guess a state: "844 Dravis St SE" matches nothing, while
// "844 Dravis St SE, OH" finds it in Girard. Everything here is Ohio-only, so a
// search that finds nothing and names no ZIP or state is retried once with
// ", OH" appended (1.1.0).
//
// Each Ohio match becomes a deep link into that county's parcels app
// (parcels-core 1.11.0, data/deepLink.ts):
//   <app>?q=<street>, <zip>&lat=<lat>&lon=<lon>

import { PARCELS_APPS } from "./parcelsApps.js";

export const GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

const OHIO_STATE_FIPS = "39";

/**
 * @typedef {Object} AddressMatch
 * @property {string} address     Matched address as the geocoder prints it: "4761 WATERLOO RD, ATWATER, OH, 44201"
 * @property {string} street      The part before the first comma: "4761 WATERLOO RD"
 * @property {string} zip         5-digit ZIP, or ""
 * @property {number} lat
 * @property {number} lon
 * @property {string} countyFips  5-digit county GEOID, e.g. "39133", or "" when the geocoder gave none
 * @property {string} countyName  e.g. "Portage County"
 */

/**
 * @typedef {Object} ParcelsLink
 * @property {AddressMatch} match
 * @property {string} county      County name without "County": "Portage"
 * @property {string} url         The parcels app, deep-linked to this address
 */

/**
 * @typedef {Object} LookupResult
 * @property {"found"|"none"|"not-ohio"|"no-app"|"error"} status
 *   found:    at least one Ohio match with a parcels app (see `links`)
 *   none:     the geocoder matched nothing
 *   not-ohio: it matched, but only outside Ohio
 *   no-app:   Ohio matches, but no parcels app for their county
 *   error:    the geocoder could not be reached or answered nonsense
 * @property {ParcelsLink[]} links
 * @property {AddressMatch[]} matches  every match the geocoder returned
 * @property {string} [error]
 */

/** Longest address sent to the geocoder. */
const MAX_ADDRESS = 200;

/** How many matches a UI should list before asking for a city or ZIP. */
export const MAX_LISTED = 10;

const US_STATES = new Set(
  ("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd " +
    "oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc").split(" "),
);

/**
 * The address to retry with when the first search finds nothing, or null when
 * a retry would not help: the address already has a ZIP, or already ends in a
 * state (", OH", " Ohio", ", PA", ...).
 * @param {string} address
 * @returns {string | null}
 */
export function ohioRetryAddress(address) {
  const a = address.replace(/\s+/g, " ").trim().replace(/[,.\s]+$/, "");
  if (!a) return null;
  if (/\b\d{5}(?:-\d{4})?$/.test(a)) return null;
  // "..., Ohio" / "... OH" / "..., PA": a state is already named. A bare
  // two-letter word only counts after a comma, because street suffixes and
  // directionals collide with state codes ("Main Ct" = CT, "Oak St NE" = NE).
  if (/[,\s](oh|ohio)$/i.test(a)) return null;
  const st = a.match(/,\s*([a-z]{2})$/i)?.[1]?.toLowerCase();
  if (st && US_STATES.has(st)) return null;
  return a + ", OH";
}

/**
 * The geocoder request URL for an address.
 * @param {string} address
 * @param {string} [jsonpCallback]  when given, asks for JSONP calling this global function
 * @returns {string}
 */
export function geocoderUrl(address, jsonpCallback) {
  const params = new URLSearchParams({
    address: address.trim().slice(0, MAX_ADDRESS),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "Counties",
    format: jsonpCallback ? "jsonp" : "json",
  });
  if (jsonpCallback) params.set("callback", jsonpCallback);
  return GEOCODER_URL + "?" + params.toString();
}

/**
 * Pull the matches out of a geocoder response. Tolerant: anything missing or
 * malformed is skipped, never thrown on.
 * @param {unknown} json
 * @returns {AddressMatch[]}
 */
export function parseMatches(json) {
  const raw = /** @type {any} */ (json)?.result?.addressMatches;
  if (!Array.isArray(raw)) return [];
  /** @type {AddressMatch[]} */
  const out = [];
  for (const m of raw) {
    const address = typeof m?.matchedAddress === "string" ? m.matchedAddress : "";
    const lon = Number(m?.coordinates?.x);
    const lat = Number(m?.coordinates?.y);
    if (!address || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const county = Array.isArray(m?.geographies?.Counties) ? m.geographies.Counties[0] : undefined;
    const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\s*$/);
    out.push({
      address,
      street: address.split(",")[0].trim(),
      zip: zipMatch ? zipMatch[1] : "",
      lat,
      lon,
      countyFips: typeof county?.GEOID === "string" ? county.GEOID : "",
      countyName: typeof county?.NAME === "string" ? county.NAME : "",
    });
  }
  return out;
}

/**
 * The deep link into a county's parcels app for a match, or null when that
 * county has no parcels app.
 * @param {AddressMatch} match
 * @param {Record<string, {county: string, url: string}>} [apps]
 * @returns {ParcelsLink | null}
 */
export function parcelsLink(match, apps = PARCELS_APPS) {
  const app = apps[match.countyFips];
  if (!app) return null;
  const params = new URLSearchParams();
  // Street + ZIP: enough for the app's search to find the parcel, and the ZIP
  // keeps "100 MAIN ST" from matching every town in the county. The city is
  // left out on purpose - the Auditor usually records the township instead.
  params.set("q", match.zip ? match.street + ", " + match.zip : match.street);
  params.set("lat", match.lat.toFixed(6));
  params.set("lon", match.lon.toFixed(6));
  return { match, county: app.county, url: app.url + "?" + params.toString() };
}

/**
 * Classify a geocoder response.
 * @param {unknown} json
 * @param {Record<string, {county: string, url: string}>} [apps]
 * @returns {LookupResult}
 */
export function resolve(json, apps = PARCELS_APPS) {
  const matches = parseMatches(json);
  if (matches.length === 0) return { status: "none", links: [], matches };
  const ohio = matches.filter((m) => m.countyFips.startsWith(OHIO_STATE_FIPS) && m.countyFips.length === 5);
  if (ohio.length === 0) return { status: "not-ohio", links: [], matches };
  const links = /** @type {ParcelsLink[]} */ (ohio.map((m) => parcelsLink(m, apps)).filter(Boolean));
  return { status: links.length ? "found" : "no-app", links, matches };
}

/**
 * Look an address up with fetch(). For the extension's service worker, whose
 * host permission lets it call the geocoder despite the missing CORS headers.
 * @param {string} address
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<LookupResult>}
 */
export async function lookupWithFetch(address, fetchImpl = fetch) {
  if (!address.trim()) return { status: "none", links: [], matches: [] };
  /** @param {string} a @returns {Promise<LookupResult>} */
  const once = async (a) => {
    try {
      const res = await fetchImpl(geocoderUrl(a));
      if (!res.ok) return { status: "error", links: [], matches: [], error: "geocoder HTTP " + res.status };
      return resolve(await res.json());
    } catch (e) {
      return { status: "error", links: [], matches: [], error: String(e) };
    }
  };
  return withOhioRetry(address, once);
}

/**
 * Run a lookup; when it finds nothing and the address names no ZIP or state,
 * run it once more with ", OH" appended.
 * @param {string} address
 * @param {(a: string) => Promise<LookupResult>} once
 * @returns {Promise<LookupResult>}
 */
async function withOhioRetry(address, once) {
  const first = await once(address);
  if (first.status !== "none") return first;
  const retry = ohioRetryAddress(address);
  return retry ? once(retry) : first;
}

let jsonpSeq = 0;

/**
 * Look an address up with JSONP. For web pages (the hub), which cannot fetch()
 * the geocoder because it sends no CORS headers.
 * @param {string} address
 * @param {{ doc?: Document, win?: any, timeoutMs?: number }} [opts]
 * @returns {Promise<LookupResult>}
 */
export function lookupWithJsonp(address, opts = {}) {
  if (!address.trim()) return Promise.resolve({ status: "none", links: [], matches: [] });
  return withOhioRetry(address, (a) => jsonpOnce(a, opts));
}

/**
 * One JSONP request.
 * @param {string} address
 * @param {{ doc?: Document, win?: any, timeoutMs?: number }} opts
 * @returns {Promise<LookupResult>}
 */
function jsonpOnce(address, opts) {
  const doc = opts.doc ?? document;
  const win = opts.win ?? window;
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((done) => {
    const cb = "__addressLookup" + Date.now().toString(36) + (jsonpSeq++);
    const script = doc.createElement("script");
    let settled = false;
    /** @param {LookupResult} r */
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { delete win[cb]; } catch { win[cb] = undefined; }
      script.remove();
      done(r);
    };
    const timer = setTimeout(
      () => finish({ status: "error", links: [], matches: [], error: "geocoder timed out" }),
      timeoutMs,
    );
    win[cb] = (/** @type {unknown} */ json) => finish(resolve(json));
    script.onerror = () => finish({ status: "error", links: [], matches: [], error: "geocoder unreachable" });
    script.src = geocoderUrl(address, cb);
    doc.head.appendChild(script);
  });
}
