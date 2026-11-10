/**
 * address-match — fleet address matcher (FleetShareableCodeComponents/address-match).
 *
 * Matches a street address from an outside file (a voter roll, a DOLC liquor
 * permit, a business list) against the datasets the fleet already has for a
 * county, strictest tier first:
 *
 *   address points   <County>CountyAddressPoints/.../address-points.json  (where it exists)
 *   parcels          <County>CountyParcels/.../parcels.json                (every county; chunked index honoured)
 *   voter addresses  <County>CountyVoters/.../voters.json                  (every county; carries the PRECINCT)
 *
 * and places the point inside polygons (jurisdictions, precincts) with a
 * bounding-box-first ray cast.
 *
 * The normalisation here is the one that took the Voters fleet from 54% to
 * ~90% placed — trailing quadrants, two-letter auditor street types, "STATE
 * ROUTE 46" vs "ST RTE 46 NE", county/township road spellings, places and
 * ZIPs written into the situs address, doubles with number ranges — lifted
 * out of voters-core/geocode-voters.mjs so every consumer matches the same way.
 *
 * Plain ESM, no dependencies, Node 18+. Vendored into consumers by
 * Statehouse/scripts/sync-shared-code.py --lib address-match.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ------------------------------------------------------------------ tokens ---

/**
 * How far apart candidate points may be and still count as "the same place",
 * in degrees. 0.004° ≈ 400 m: tight enough that any of them puts the dot on
 * the right block, loose enough to tolerate a parcel centroid sitting a lot
 * away from an address point on the same lot.
 */
export const TIGHT_DEG = 0.004;

/** Match tiers, strictest first. 0 = not placed. */
export const TIER = {
  NONE: 0,
  EXACT: 1, // address point: street + city/ZIP, full string
  QUADRANT: 2, // address point: same once a trailing N/S/E/W/... is ignored
  NO_TYPE: 3, // address point: same once the street type is ignored too
  ADDRESS_ELSEWHERE: 4, // address point matches, but under another city/ZIP
  PARCEL: 5, // a parcel with that address
  PREFIX: 6, // one street name is a word-prefix of the other (YOUNGSTOWN / YOUNGSTOWN HUBBARD)
  VOTER: 7, // a registered voter's address (coordinates and precinct from the roll)
  STREET: 8, // nearest known number on the same street and ZIP/city (a tenant in a multi-address parcel); approximate
};
export const TIER_NAMES = ["none", "exact", "quadrant", "noType", "addressElsewhere", "parcel", "prefix", "voter", "street"];

/** For the STREET tier: how far along the street a known number may be from the wanted one. */
export const STREET_MAX_DELTA = 60;

const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const DIRECTIONAL_WORDS = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};
const STREET_TYPES = {
  ROAD: "RD", STREET: "ST", AVENUE: "AVE", AV: "AVE", TR: "TRL", DRIVE: "DR", LANE: "LN",
  COURT: "CT", BOULEVARD: "BLVD", CIRCLE: "CIR", PLACE: "PL",
  TERRACE: "TER", TRAIL: "TRL", PARKWAY: "PKWY", HIGHWAY: "HWY", SQUARE: "SQ",
  // Franklin's auditor uses two-letter types: BL(VD), WY (WAY), CR (CIR),
  // LP (LOOP), PW (PKWY), PI (PIKE), TE (TER). Not PK: "PARK" is a street
  // NAME far more often than a type ("438 N PARK AVE"), so it stays a word.
  BL: "BLVD", WY: "WAY", CR: "CIR", LP: "LOOP", PW: "PKWY", PI: "PIKE", TE: "TER",
  // Montgomery's auditor spells out what others abbreviate.
  BRIDGE: "BRG", SAINT: "ST", CROSSING: "XING",
};
const TYPE_SUFFIXES = new Set([
  "RD", "ST", "AVE", "DR", "LN", "CT", "BLVD", "CIR", "PL", "TER", "TRL",
  "PKWY", "HWY", "SQ", "WAY", "RUN", "PT", "LOOP", "PATH", "XING", "PIKE", "BRG",
]);
// Longest alternatives first so "ST RTE" isn't eaten by the "ST RT" branch.
const ROUTE_RE =
  /\b(?:STATE\s+ROUTE|STATE\s+RTE|STATE\s+RT|ST\s+ROUTE|ST\s+RTE|ST\s+RT|ROUTE|RTE|RT)\b/g;
const UNIT_RE = /\b(?:APTS?|UNITS?|STES?|SUITES?|LOTS?|TRLR|RM|FLS?|FLOORS?|BLDGS?|REAR|BSMT|BASEMENT|PATIO|BOX\s+\d+|RR\s?\d+)\b.*$/;
// "932 HURON ST 1ST FL", "307 SYCAMORE ST, 2ND FLOOR": the ordinal goes with the floor.
const FLOOR_RE = /,?\s*\b(?:\d+(?:ST|ND|RD|TH)|FIRST|SECOND|THIRD)(?:\s*(?:&|AND)\s*\d+(?:ST|ND|RD|TH))?\s+(?:FLS?|FLOORS?)\b.*$/;
// Numbered streets: one roll writes "W 117TH ST", another "W 117 ST", a third "FOURTH ST".
const ORDINAL_WORDS = {
  FIRST: "1", SECOND: "2", THIRD: "3", FOURTH: "4", FIFTH: "5", SIXTH: "6", SEVENTH: "7", EIGHTH: "8",
  NINTH: "9", TENTH: "10", ELEVENTH: "11", TWELFTH: "12", THIRTEENTH: "13", FOURTEENTH: "14",
  FIFTEENTH: "15", SIXTEENTH: "16", SEVENTEENTH: "17", EIGHTEENTH: "18", NINETEENTH: "19", TWENTIETH: "20",
};
// Words spelled two ways inside street names (not street types).
const NAME_WORDS = { CENTER: "CTR", CENTRE: "CTR", PLAZA: "PLZ", HEIGHTS: "HTS", HGTS: "HTS", MOUNT: "MT" };

/** Upper-case token list with units, routes, directionals and types normalised. */
export function tokenize(street) {
  let s = String(street ?? "").toUpperCase();
  // Some parcel rolls end the situs address with the state ("5234 US ROUTE 6, OH").
  s = s.replace(/,\s*[A-Z]{2}\s*$/, "");
  // ...and annotate state routes in parentheses: "3703 LAKE (SR 531) RD".
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/#.*$/, "").replace(FLOOR_RE, "").replace(UNIT_RE, "");
  // The house number: "09891" -> "9891"; "1050 1/2" and "610 1 2" (a half
  // address) -> the whole number; "18334-B" / "530C" / "590 D" (a unit letter,
  // but never a lone N/S/E/W, which is the street's directional) -> the number.
  // "CR 25-A" -> "CR 25A" (and "18334-B BAGLEY" -> "18334B", stripped below).
  s = s.replace(/\b(\d+)\s*-\s*([A-Z])\b(?!\s*-)/g, "$1$2");
  s = s.replace(/^\s*0+(?=\d)/, "")
    .replace(/^\s*(\d+)\s+1\s*[\/ ]\s*2\s+(?=\S)/, "$1 ")
    .replace(/^\s*(\d+)\s*-\s*[A-Z]\s+(?!(?:ST|STREET|AVE|AVENUE)\b)(?=\S)/, "$1 ")
    .replace(/^\s*(\d+)[A-Z]\s+(?=\S)/, "$1 ")
    .replace(/^\s*(\d+)\s+[A-DF-MO-RT-VX-Z]\s+(?!(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|CT|LN|PL|BLVD|WAY|[A-Z]\s+(?:RD|ROAD|ST|AVE)|[A-Z]\s*$|AND)\b)(?![&])(?=\S)/, "$1 ");
  // Routes written without a space or with a hyphen: "SR598", "US22", "OH-14", "CR16", "TR 5".
  s = s.replace(/\b(SR|US|USR|OH|CR|TR)\s*-?\s*(\d{1,4}[A-Z]?)\b/g, (_, k, n) => `${k === "OH" || k === "USR" ? "SR" : k} ${n.replace(/^(\d+)([NSEW])$/, "$1 $2")}`);
  s = s.replace(/\bU\.?\s?S\.?\s+(?:HIGHWAY|HWY|ROUTE|RTE|RT)\s+(?=\d)/g, "SR ").replace(/\bS\.\s?R\.\s*(?=\d)/g, "SR ");
  s = s.replace(ROUTE_RE, "SR");
  // A US route is "US RT 42" on one file and "RT 42 ST" on another; Ohio never
  // gives a state route a US route's number, so both are "SR 42".
  s = s.replace(/\bUS\s+(?:HWY\s+)?(?:SR\s+)?(?=\d)/g, "SR ");
  // County and township roads in every spelling -> "CO RD 170" / "TWP RD 134".
  s = s
    .replace(/\b(?:CO|CR|CTY|COUNTY)\s+(?:RD|ROAD)\s+(\d+[A-Z]?)\b/g, "CO RD $1")
    .replace(/\b(?:CO|CTY|COUNTY)\s+(\d+[A-Z]?)\s+(?:RD|ROAD)\b/g, "CO RD $1")
    .replace(/\bCR\s+(\d+[A-Z]?)\b/g, "CO RD $1")
    .replace(/\b(?:TWP|TR|TOWNSHIP)\s+(?:RD|ROAD)\s+(\d+[A-Z]?)\b/g, "TWP RD $1")
    .replace(/\b(?:TWP|TOWNSHIP)\s+(\d+[A-Z]?)\s+(?:RD|ROAD)\b/g, "TWP RD $1")
    .replace(/\b(?:TR|TWP)\s+(\d+[A-Z]?)\b/g, "TWP RD $1");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  const toks = s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => DIRECTIONAL_WORDS[t] ?? t)
    .map((t) => STREET_TYPES[t] ?? NAME_WORDS[t] ?? t)
    // "117TH" / "FOURTH" -> "117" / "4", except as the first token (a
    // numberless "5TH ST" must not turn into house number 5).
    .map((t, i) => (i === 0 ? t : ORDINAL_WORDS[t] ?? t.replace(/^(\d+)(?:ST|ND|RD|TH)$/, "$1")))
    // "HILLS & DALES RD" on one file, "HILLS AND DALES RD" on another.
    .filter((t, i, a) => !(t === "AND" && i > 1 && i < a.length - 1));
  // Lawrence's auditor: "NO 3RD ST" / "SO 3RD ST".
  for (let i = 0; i < toks.length - 1; i++) if (toks[i] === "NO" || toks[i] === "SO") toks[i] = toks[i][0];
  // A trailing PK is a pike ("WOOSTER PK", "OLD TROY PK N"); elsewhere PARK stays a word.
  let last = toks.length - 1;
  while (last > 1 && DIRECTIONALS.has(toks[last])) last--;
  if (last > 1 && toks[last] === "PK") toks[last] = "PIKE";
  return toks;
}

/** A city, village or township name reduced to what two files agree on: "Liberty Twp" = "LIBERTY TOWNSHIP" = "LIBERTY". */
export function placeKey(name) {
  return String(name ?? "").toUpperCase()
    .replace(/\b(?:THE\s+)?(?:CITY|VILLAGE)\s+OF\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(?:HEIGHTS|HGTS)\b/g, "HTS").replace(/\bMOUNT\b/g, "MT").replace(/\bSAINT\b/g, "ST")
    .replace(/\s+OH(?:IO)?\s*$/, "")
    .replace(/\s+(?:TOWNSHIP|TWP|CITY|VILLAGE)\s*$/, "")
    .replace(/\s+/g, " ").trim();
}

/** ["3910","E","RIVER","RD","SW"] -> { number: "3910", rest: [...] } */
export function splitAddress(street) {
  const t = tokenize(street);
  const number = t.length && /^\d+$/.test(t[0]) ? t[0] : "";
  return { number, rest: number ? t.slice(1) : t };
}

/**
 * Addresses that name several numbers — "1810-12 N 4TH ST", "1088 & 1100 N
 * HIGH ST", "16 S MARKET ST & 103-05 W LIBERTY ST" (DOLC permits do this for
 * a bar that spans two storefronts). Returns the distinct house numbers and
 * the street each goes with, first form first, so a caller can try each.
 */
export function splitCompound(street) {
  const whole = String(street ?? "").toUpperCase().trim();
  const out = [];
  const seen = new Set();
  const add = (addr) => {
    const a = addr.replace(/\s+/g, " ").trim();
    if (a && !seen.has(a)) { seen.add(a); out.push(a); }
  };
  // DOLC writes a second line for a place name, an AKA or a patio:
  // "KENWOOD TOWNE CENTRE\n7801 MONTGOMERY RD", "12700 TWP RD 477\nAKA 9090
  // VETERANS WAY". Each line is tried; one that leads with a name but has the
  // address after a comma ("ARTS CENTER ANNEX, 6620 MONTGOMERY RD") gives that part.
  const lines = [];
  for (let ln of whole.split(/[\r\n]+/)) {
    ln = ln.replace(/^\s*(?:AKA|&|AND)\s+/, "").trim();
    if (!ln) continue;
    if (!/^\d/.test(ln)) ln = ln.split(/,\s*/).find((seg) => /^\d+\s+\S/.test(seg)) ?? ln;
    lines.push(ln);
  }
  for (const s of lines.length ? lines : [whole]) {
  // "5676-78-80 MAYBERRY SQ", "8097-8101-05 MAIN ST", "1291 1295 GRANDVIEW AVE": a run of numbers.
  const run = s.match(/^(\d+)((?:\s*[-,&]\s*\d+){2,}|\s+\d{3,}(?=\s+[A-Z]))\s+(.+)$/);
  if (run && !/^\d+(?:ST|ND|RD|TH)\b/.test(run[3]) && (run[2].trim().length === run[1].length || /[-,&]/.test(run[2]))) {
    add(`${run[1]} ${run[3]}`);
    for (let n of run[2].match(/\d+/g).slice(0, 4)) {
      if (n.length < run[1].length) n = run[1].slice(0, run[1].length - n.length) + n; // 5676-78 → 5678
      add(`${n} ${run[3]}`);
    }
    continue;
  }
  // "A & B" / "A AND B" where B is a full address or another number → both.
  // ("46638 Y & O RD", "4715 HILLS & DALES RD": the & belongs to the street name.)
  // An & after a complete street ("2092 WOODVILLE RD & PATIOS") starts an add-on, dropped here.
  const addOn = s.match(/^(\d+\s+.*?\S)\s+(?:&|AND)\s+(?!\d)/);
  let body = s;
  if (addOn) {
    const left = withoutQuadrant(tokenize(addOn[1]));
    if (left.length > 2 && TYPE_SUFFIXES.has(left[left.length - 1])) body = addOn[1];
  }
  const amp = body.split(/\s+(?:&|AND)\s+(?=\d)/);
  for (let part of amp) {
    // "1810-12 N 4TH ST" → 1810 and 1812; "103-05 W LIBERTY" → 103 and 105.
    const m = part.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
    if (m) {
      const lo = m[1];
      let hi = m[2];
      if (hi.length < lo.length) hi = lo.slice(0, lo.length - hi.length) + hi; // 1810-12 → 1812
      add(`${lo} ${m[3]}`);
      if (Number(hi) > Number(lo) && Number(hi) - Number(lo) <= 12) add(`${hi} ${m[3]}`);
      continue;
    }
    // "B" with no street of its own ("1088 & 1100 N HIGH ST" → "1100 N HIGH ST" is the
    // second part; the first is just "1088"): borrow the street from the other part.
    if (/^\d+(?:\s+1\s*[\/ ]\s*2)?$/.test(part) && amp.length > 1) {
      part = part.match(/^\d+/)[0];
      const other = amp.find((p) => /^\d+\s+\S/.test(p) && !/^\d+\s+1\s*[\/ ]\s*2$/.test(p));
      if (other) { add(`${part} ${other.replace(/^\d+\s+/, "")}`); continue; }
    }
    add(part);
  }
  }
  return out.length ? out : [whole];
}

/** Street name with any trailing directionals removed. */
export function withoutQuadrant(rest) {
  const r = [...rest];
  while (r.length && DIRECTIONALS.has(r[r.length - 1])) r.pop();
  return r;
}

/** The directional a street name ends with, after any type suffix: "MAIN ST W" -> "W"; else null. */
export function trailingDirectional(rest) {
  const r = [...rest];
  while (r.length && DIRECTIONALS.has(r[r.length - 1])) r.pop();
  if (r.length === rest.length) return null;
  return rest[rest.length - 1];
}

/** Street name with the trailing directionals AND the type suffix removed. */
export function coreName(rest) {
  // A street whose whole name is a directional or a type ("2154 SOUTH AVE",
  // "1824 PARKWAY AVE") keeps that one word.
  const r = withoutQuadrant(rest);
  if (r.length === 0) return rest.slice(0, 1);
  if (r.length > 1 && TYPE_SUFFIXES.has(r[r.length - 1])) r.pop();
  // "HIGH N ST" -> HIGH, but "E NORTH ST" keeps its name: -> E N.
  while (r.length > 1 && DIRECTIONALS.has(r[r.length - 1]) && !DIRECTIONALS.has(r[r.length - 2])) r.pop();
  return r;
}

/** The core name with its leading directional removed too, or null when there is none. */
export function coreWithoutLead(core) {
  return core.length > 1 && DIRECTIONALS.has(core[0]) ? core.slice(1) : null;
}

// -------------------------------------------------------------- candidates ---
// A candidate is [lat, lon, meta]; meta is whatever the source attached
// (parcel number, precinct) and is carried through to the result.

/** True when every candidate sits within TIGHT_DEG (or `within`) of the others. */
export function samePlace(points, within = TIGHT_DEG) {
  if (!points || points.length === 0) return false;
  if (points.length === 1) return true;
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return Math.max(latMax - latMin, lonMax - lonMin) < within;
}

/** Mean of a candidate set (already known to be in one place) plus the meta they agree on. */
export function centroid(points) {
  let lat = 0, lon = 0;
  for (const p of points) { lat += p[0]; lon += p[1]; }
  const metas = new Set(points.map((p) => JSON.stringify(p[2] ?? null)));
  const meta = metas.size === 1 ? points[0][2] ?? null : null;
  return {
    lat: Number((lat / points.length).toFixed(6)),
    lon: Number((lon / points.length).toFixed(6)),
    meta,
    candidates: points.length,
  };
}

const push = (map, key, value) => {
  const cur = map.get(key);
  if (cur) cur.push(value);
  else map.set(key, [value]);
};

/**
 * Candidates whose name is a word-prefix of the wanted name or vice versa,
 * allowing either side to truncate a word to four letters or more. With
 * `oneStreet`, every match must be the same street name — for the no-ZIP
 * bucket, where candidates come from the whole county.
 */
export function prefixMatches(candidates, wanted, oneStreet = false) {
  if (!candidates || wanted.length === 0) return [];
  const out = [];
  const names = new Set();
  for (const [name, point] of candidates) {
    if (name.length === 0) continue;
    // A name that is only a directional ("EAST ST" -> ["E"]) is a prefix of
    // every "E ..." street; it can only match itself.
    if ((name.length === 1 && DIRECTIONALS.has(name[0])) !== (wanted.length === 1 && DIRECTIONALS.has(wanted[0]))) continue;
    const [short, long] = name.length <= wanted.length ? [name, wanted] : [wanted, name];
    let ok = true;
    for (let i = 0; i < short.length; i++) {
      if (short[i] === long[i]) continue;
      const a = short[i], b = long[i];
      const trunc = a.length >= 4 && b.length >= 4 && (b.startsWith(a) || a.startsWith(b));
      if (!trunc) { ok = false; break; }
    }
    if (ok) { out.push(point); names.add(name.join(" ")); }
  }
  return oneStreet && names.size > 1 ? [] : out;
}

// ------------------------------------------------------------------ files ---

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** null when the file isn't there — a county may simply not have that dataset. */
export function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null;
}

/**
 * A big county's Parcels app splits its roll into chunks and leaves an index
 * in parcels.json ({ "chunks": [...], "count": N }). Follow the index; a plain
 * array is used as it is.
 */
export function readChunked(indexPath) {
  const data = readJson(indexPath);
  if (Array.isArray(data)) return data;
  if (!data || !Array.isArray(data.chunks)) throw new Error(`${indexPath}: expected an array or a { chunks: [...] } index`);
  const dir = dirname(indexPath);
  const all = [];
  for (const chunk of data.chunks) for (const p of readJson(join(dir, chunk))) all.push(p);
  return all;
}

// ------------------------------------------------------- parcel addresses ---

/**
 * The street part of a parcel's situs address and the ZIP it carried, for
 * layers that write the place into the address ("291  BURNS RD  FAIRFIELD
 * 45014", "3595 LENNOX CL BRUNSWICK 44212", "1344 PITTENGER RD, Weller
 * Township"). `cities` is the consumer's own city list (upper-case), used to
 * know how many words the place is.
 */
export function parcelStreetZip(f, cities = EMPTY_SET, cityMaxWords = 1) {
  const parts = String(f ?? "").split(",")[0].trim().split(/\s{2,}/);
  const last = parts[parts.length - 1];
  let zip = "";
  if (parts.length >= 2 && /^[A-Z][A-Z .'-]*\s\d{5}(?:-\d{4})?$/i.test(last)) { zip = last.match(/(\d{5})/)[1]; parts.pop(); }
  let s = parts.join(" ");
  const zipped = s.match(/^(.*\S)\s+(\d{5})(?:[- ]\d{4})?$/);
  if (zipped) {
    s = zipped[1];
    zip = zip || zipped[2];
    s = s.replace(/\s+OH$/i, "");
    const w = s.toUpperCase().split(/\s+/);
    let cut = -1;
    for (let n = Math.min(cityMaxWords, w.length - 2); n >= 1 && cut < 0; n--) {
      if (cities.has(w.slice(-n).join(" "))) cut = w.length - n;
    }
    if (cut < 0) {
      const toks = tokenize(s);
      for (let i = toks.length - 2; i >= 1; i--) {
        if (TYPE_SUFFIXES.has(toks[i])) { cut = i + 1; break; }
      }
      if (cut >= 0) return [toks.slice(0, cut).join(" "), zip];
    }
    if (cut > 0) s = w.slice(0, cut).join(" ");
  }
  return [s, zip];
}
const EMPTY_SET = new Set();

/**
 * A parcel that is a double carries a number range, "1025 - 1027 COLUMBUS ST".
 * Index it under each number — short ranges only, stepping by two when both
 * ends share a parity; "1 - 99 MAIN ST" is a complex and stays one address.
 */
export function parcelAddresses(street) {
  const m = street.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (!m) return [street];
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(hi >= lo) || hi - lo > 12) return [street];
  const step = hi !== lo && (hi - lo) % 2 === 0 ? 2 : 1;
  const out = [];
  for (let n = lo; n <= hi; n += step) out.push(`${n} ${m[3]}`);
  return out;
}

// ------------------------------------------------------------------ index ---

/**
 * Build the match index for one county.
 *
 *   addressPoints  [{ a: street, c: city, z: zip, x, y }]           optional
 *   parcels        [{ n: parcelNumber, f: situs, z: zip, x, y, j }] optional
 *   voters         voters.json as the *CountyVoters apps write it     optional
 *   cities         the consumer's own city names (any case)          optional
 */
export function buildIndex({ addressPoints = null, parcels = null, voters = null, cities = [] } = {}) {
  const cityset = new Set(cities.map((c) => String(c).toUpperCase().trim()).filter(Boolean));
  const cityMax = Math.max(1, ...[...cityset].map((c) => c.split(/\s+/).length));
  const ix = {
    apExact: new Map(), apQuadrant: new Map(), apCore: new Map(), apAnywhere: new Map(), apByNumberZip: new Map(),
    pcCore: new Map(), pcAnywhere: new Map(), pcByNumberZip: new Map(),
    vrCore: new Map(), vrAnywhere: new Map(),
    /** core street name + ZIP (and + city) -> [[number, point], ...] from every source, for the STREET tier */
    byStreet: new Map(),
    counts: { addressPoints: 0, parcels: 0, voters: 0 },
  };
  const indexStreet = (coreStr, geos, number, point, dir = null) => {
    for (const geo of geos) if (geo) push(ix.byStreet, `${coreStr}|${geo}`, [Number(number), point, dir]);
  };

  for (const p of addressPoints ?? []) {
    if (p.y == null || p.x == null) continue;
    const point = [p.y, p.x, null];
    const { number, rest } = splitAddress(p.a);
    const city = String(p.c ?? "").toUpperCase().trim();
    const zip = String(p.z ?? "");
    const full = rest.join(" ");
    const quad = withoutQuadrant(rest).join(" ");
    const core = coreName(rest);
    const coreStr = core.join(" ");
    for (const geo of [city, zip]) {
      push(ix.apExact, `${number}|${full}|${geo}`, point);
      push(ix.apQuadrant, `${number}|${quad}|${geo}`, point);
      push(ix.apCore, `${number}|${coreStr}|${geo}`, point);
    }
    push(ix.apAnywhere, `${number}|${coreStr}`, point);
    push(ix.apByNumberZip, `${number}|${zip}`, [core, point]);
    if (number) indexStreet(coreStr, new Set([zip, city, placeKey(city)]), number, point, trailingDirectional(rest));
    ix.counts.addressPoints++;
  }

  for (const p of parcels ?? []) {
    if (!p.y || !p.x) continue;
    const [street, zipFromAddress] = parcelStreetZip(p.f, cityset, cityMax);
    for (const addr of parcelAddresses(street)) {
      const { number, rest } = splitAddress(addr);
      if (!number) continue;
      const point = [p.y, p.x, { parcelId: p.n ?? null, jurisdiction: p.j ?? null }];
      const zip = zipFromAddress || String(p.z ?? "").slice(0, 5);
      const core = coreName(rest);
      const coreStr = core.join(" ");
      // The parcel's own jurisdiction is a second geography: some rolls
      // (Hamilton) carry no ZIP at all, and a permit's ZIP is often the
      // neighbouring post office's.
      const place = placeKey(p.j);
      push(ix.pcCore, `${number}|${coreStr}|${zip}`, point);
      if (place) push(ix.pcCore, `${number}|${coreStr}|${place}`, point);
      push(ix.pcAnywhere, `${number}|${coreStr}`, point);
      push(ix.pcByNumberZip, `${number}|${zip}`, [core, point]);
      const lead = trailingDirectional(rest);
      indexStreet(coreStr, new Set([zip, place]), number, point, lead);
      if (lead && !DIRECTIONALS.has(core[0])) {
        const led = [lead, ...core];
        const ledStr = led.join(" ");
        push(ix.pcCore, `${number}|${ledStr}|${zip}`, point);
        push(ix.pcAnywhere, `${number}|${ledStr}`, point);
        push(ix.pcByNumberZip, `${number}|${zip}`, [led, point]);
      }
    }
    ix.counts.parcels++;
  }

  if (voters?.voters?.length) {
    const F = Object.fromEntries((voters.fields ?? []).map((f, i) => [f, i]));
    const need = ["street", "city", "zip", "lat", "lon", "precinct"];
    if (need.every((k) => k in F)) {
      const vcities = voters.cities ?? [];
      const vzips = voters.zips ?? [];
      const vprec = voters.precincts ?? [];
      for (const v of voters.voters) {
        const lat = v[F.lat], lon = v[F.lon];
        if (lat == null || lon == null) continue;
        const { number, rest } = splitAddress(v[F.street]);
        if (!number) continue;
        const zip = String(vzips[v[F.zip]] ?? v[F.zip] ?? "");
        const city = String(vcities[v[F.city]] ?? v[F.city] ?? "").toUpperCase().trim();
        const precinct = vprec[v[F.precinct]] ?? (typeof v[F.precinct] === "string" ? v[F.precinct] : null);
        const point = [lat, lon, { precinct: precinct ?? null }];
        const coreStr = coreName(rest).join(" ");
        for (const geo of [city, zip]) push(ix.vrCore, `${number}|${coreStr}|${geo}`, point);
        push(ix.vrAnywhere, `${number}|${coreStr}`, point);
        indexStreet(coreStr, new Set([zip, city, placeKey(city)]), number, point, trailingDirectional(rest));
        ix.counts.voters++;
      }
    }
  }
  return ix;
}

/** Try one bucket; a hit only when the candidates agree on a place. */
function lookup(map, key) {
  const pts = map.get(key);
  return pts && samePlace(pts) ? centroid(pts) : null;
}

/**
 * Match one address. Returns
 *   { tier, lat, lon, parcelId, jurisdiction, precinct, candidates }
 * with tier TIER.NONE and nulls when nothing fits.
 */
export function matchAddress(ix, { street, city = "", zip = "", muni = "" }) {
  const none = { tier: TIER.NONE, lat: null, lon: null, parcelId: null, jurisdiction: null, precinct: null, candidates: 0 };
  const { number, rest } = splitAddress(street);
  if (!number) return none;
  city = String(city ?? "").toUpperCase().replace(/\s+OH$/, "").trim();
  zip = String(zip ?? "").slice(0, 5);
  // Places to try after the ZIP: the city as written, then city and
  // municipality/township reduced to a bare name (matches a parcel's jurisdiction).
  const places = [...new Set([city, placeKey(city), placeKey(muni)])].filter(Boolean);
  const full = rest.join(" ");
  const quad = withoutQuadrant(rest).join(" ");
  const core = coreName(rest);
  const coreStr = core.join(" ");
  const quadDir = trailingDirectional(rest);
  // "275 PARK AVE W": parcels are also indexed as "W PARK" (see buildIndex).
  const ledStr = quadDir && !DIRECTIONALS.has(core[0]) ? `${quadDir} ${coreStr}` : null;
  const noLead = coreWithoutLead(core);
  const noLeadStr = noLead ? noLead.join(" ") : null;

  let hit = null;
  let tier = TIER.NONE;

  // 1-3: address points with the geography agreeing. Only EXACT may take a
  // candidate on faith; the looser forms must prove the candidates co-locate.
  for (const [map, form, code] of [
    [ix.apExact, full, TIER.EXACT],
    [ix.apQuadrant, quad, TIER.QUADRANT],
    [ix.apCore, coreStr, TIER.NO_TYPE],
    ...(noLeadStr ? [[ix.apCore, noLeadStr, TIER.NO_TYPE]] : []),
  ]) {
    for (const geo of [city, zip]) {
      if (!geo) continue;
      const pts = map.get(`${number}|${form}|${geo}`);
      if (!pts) continue;
      if (code === TIER.EXACT) { hit = centroid([pts[0]]); tier = code; break; }
      if (samePlace(pts)) { hit = centroid(pts); tier = code; break; }
    }
    if (hit) break;
  }
  // 4: the address point exists under another city/ZIP.
  if (!hit) { const h = lookup(ix.apAnywhere, `${number}|${coreStr}`); if (h) { hit = h; tier = TIER.ADDRESS_ELSEWHERE; } }
  // 5: the parcel roll (gives the parcel number).
  if (!hit) {
    const inPlace = (form) => { for (const g of places) { const x = lookup(ix.pcCore, `${number}|${form}|${g}`); if (x) return x; } return null; };
    const h = (ledStr ? lookup(ix.pcCore, `${number}|${ledStr}|${zip}`) ?? inPlace(ledStr) : null) ??
      lookup(ix.pcCore, `${number}|${coreStr}|${zip}`) ?? inPlace(coreStr) ??
      lookup(ix.pcAnywhere, `${number}|${coreStr}`) ??
      (noLeadStr && (lookup(ix.pcCore, `${number}|${noLeadStr}|${zip}`) ?? inPlace(noLeadStr) ?? lookup(ix.pcAnywhere, `${number}|${noLeadStr}`)));
    if (h) { hit = h; tier = TIER.PARCEL; }
  }
  // 5b: the file left the directional off ("430 SUPERIOR ST" for 430 N
  // SUPERIOR ST). Taken only when exactly one of N/S/E/W has that number here.
  if (!hit && core.length && !DIRECTIONALS.has(core[0])) {
    const found = [];
    for (const d of ["N", "S", "E", "W"]) {
      let h = lookup(ix.pcCore, `${number}|${d} ${coreStr}|${zip}`);
      for (const g of places) h = h ?? lookup(ix.pcCore, `${number}|${d} ${coreStr}|${g}`);
      if (h) found.push([h, TIER.PARCEL]);
      else {
        let v = null;
        for (const g of [zip, ...places]) if (g) v = v ?? lookup(ix.vrCore, `${number}|${d} ${coreStr}|${g}`);
        if (v) found.push([v, TIER.VOTER]);
      }
    }
    if (found.length === 1) [hit, tier] = found[0];
  }
  // 6: prefix / truncated-word match on the same number and ZIP.
  if (!hit) {
    for (const byNumberZip of [ix.apByNumberZip, ix.pcByNumberZip]) {
      for (const [bucket, oneStreet] of [[`${number}|${zip}`, false], [`${number}|`, true]]) {
        const cands = byNumberZip.get(bucket);
        if (!cands) continue;
        let pts = prefixMatches(cands, core, oneStreet);
        if (!samePlace(pts) && noLead) pts = prefixMatches(cands, noLead, oneStreet);
        if (samePlace(pts)) { hit = centroid(pts); tier = TIER.PREFIX; break; }
      }
      if (hit) break;
    }
  }
  // 7: a registered voter at that address (the roll is already geocoded).
  if (!hit) {
    let h = null;
    for (const geo of [city, zip, ...places]) { if (geo) h = h ?? lookup(ix.vrCore, `${number}|${coreStr}|${geo}`); }
    h = h ?? lookup(ix.vrAnywhere, `${number}|${coreStr}`) ??
      (noLeadStr && lookup(ix.vrAnywhere, `${number}|${noLeadStr}`));
    if (h) { hit = h; tier = TIER.VOTER; }
  }
  // 8: nearest known number on the same street — same ZIP (or city), within
  // STREET_MAX_DELTA, preferring the same side of the street (parity). This
  // is where a storefront in a strip mall lands: "7509 SAWMILL RD" when the
  // parcel's situs is 7501. Approximate, so no parcel is claimed.
  let approx = false;
  if (!hit) {
    const want = Number(number);
    for (const form of [coreStr, noLeadStr].filter(Boolean)) {
      for (const geo of [zip, ...places]) {
        if (!geo) continue;
        let cands = ix.byStreet.get(`${form}|${geo}`);
        if (!cands) continue;
        // "PARK AVE W" and "PARK AVE E" share a core name: keep to the side
        // the address names (or to the plain street when it names none), if known there.
        const side = cands.filter((c) => c[2] === quadDir);
        for (const pool of side.length && side.length < cands.length ? [side, cands] : [cands]) {
        let bestD = Infinity, bestPts = null;
        for (const [n, pt] of pool) {
          const d = Math.abs(n - want) + (n % 2 === want % 2 ? 0 : 0.5);
          if (d < bestD) { bestD = d; bestPts = [pt]; } else if (d === bestD) bestPts.push(pt);
        }
        // This tier is approximate already, so candidates that share the
        // nearest number may sit a few blocks apart (three parcels numbered
        // 559 along one boulevard); the exact number spread over a large site
        // (a mall's parcels, "5001 MONROE ST") gets a little more room.
        if (bestPts && bestD <= STREET_MAX_DELTA && samePlace(bestPts, TIGHT_DEG * (bestD === 0 ? 5 : 3))) {
          hit = centroid(bestPts); hit.meta = null; tier = TIER.STREET; approx = true; break;
        }
        }
        if (hit) break;
      }
      if (hit) break;
    }
  }
  if (!hit) return none;

  // Even when the point came from parcels/address points, the voter roll can
  // still name the precinct for that address.
  let precinct = hit.meta?.precinct ?? null;
  if (!precinct && ix.counts.voters) {
    const pts = ix.vrAnywhere.get(`${number}|${coreStr}`);
    if (pts && samePlace([...pts, [hit.lat, hit.lon]])) {
      const names = new Set(pts.map((p) => p[2]?.precinct).filter(Boolean));
      if (names.size === 1) precinct = [...names][0];
    }
  }
  return {
    tier,
    lat: hit.lat,
    lon: hit.lon,
    parcelId: approx ? null : hit.meta?.parcelId ?? null,
    jurisdiction: hit.meta?.jurisdiction ?? null,
    precinct,
    candidates: hit.candidates,
    approximate: approx,
  };
}

// ------------------------------------------------------------- polygons ---

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
  return true;
}

/**
 * Flatten a FeatureCollection into bbox-indexed polygon parts.
 * `props(feature)` picks what to return for a hit (default: the properties object).
 */
export function buildPolygonIndex(fc, props = (f) => f.properties) {
  const parts = [];
  for (const f of fc?.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly[0]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      parts.push({ value: props(f), poly, x0, y0, x1, y1 });
    }
  }
  return {
    size: parts.length,
    locate(lat, lon) {
      for (const p of parts) {
        if (lon < p.x0 || lon > p.x1 || lat < p.y0 || lat > p.y1) continue;
        if (inPolygon(lon, lat, p.poly)) return p.value;
      }
      return null;
    },
  };
}
