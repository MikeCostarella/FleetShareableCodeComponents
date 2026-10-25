/**
 * Add map coordinates to react-app/public/data/voters.json.
 *
 *   cd react-app && npm run geocode
 *
 * The Board of Elections export has no coordinates, so each voter's street
 * address is matched against two datasets that already live in the fleet:
 *
 *   ../TrumbullCountyAddressPoints/react-app/public/data/address-points.json
 *   ../TrumbullCountyParcels/react-app/public/data/parcels.json
 *   ../TrumbullCountyJurisdictions/react-app/public/data/jurisdictions.json
 *
 * (Paths are relative to C:\projects — i.e. the sibling repos. Nothing is
 * copied into this repo; if a sibling is missing the script says so and stops.
 * CI never runs this, because voters.json is committed with its coordinates.)
 *
 * WHY THIS ISN'T A PLAIN STRING COMPARE
 *
 * A naive "street + city" equality match places 54% of the roll. The BOE and
 * the county's address file disagree in four recurring, mechanical ways:
 *
 *   1. Trailing quadrant. The county writes "3910 EAST RIVER RD SW"; the BOE
 *      drops the SW. (Sometimes it's the BOE that has one and the county
 *      doesn't.) Matching on the name with trailing directionals removed is
 *      worth ~22 points on its own - the single biggest win here.
 *   2. Street type. "5849 YOUNGSTOWN RD" vs the parcel file's
 *      "5849 YOUNGSTOWN HUBBARD", which carries no type suffix at all.
 *   3. State routes. The BOE writes "STATE ROUTE 46"; the county writes
 *      "ST RTE 46 NE". Both collapse to "SR 46".
 *   4. Post-office city. A Hubbard voter's house can sit in the county file
 *      under MASURY with a different ZIP, so the geography has to be allowed
 *      to disagree - but only when the resulting candidates are all in the
 *      same place (see TIGHT_DEG).
 *
 * Tiers are tried strictest first and the first hit wins; `geo` on each voter
 * records which tier placed it, so the app can be honest about precision and
 * a future pass can target the weak ones.
 *
 * JURISDICTION
 *
 * Once a voter has a coordinate, it is tested against the county's 39 civil
 * boundaries to record which municipality or township it actually sits in.
 * That is NOT the same as the mailing city: the GIRARD post office serves
 * 7,133 voters, but only 3,857 of them live in the city of Girard - the rest
 * are in Liberty, Weathersfield and Hubbard townships. The app filters on the
 * boundary, the way the rest of the fleet does.
 *
 * The address-point file carries its own `j` field, which is not used here: it
 * has 64 values, including out-of-county names and post-office CDPs like
 * Bristolville and Leavittsburg that are not civil jurisdictions at all.
 * TrumbullCountyJurisdictions is the same 39 shapes the Jurisdictions app
 * draws, so testing against it keeps the two apps telling the same story.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // this *CountyVoters repo
const FLEET = resolve(ROOT, ".."); // C:\projects
const VOTERS = join(ROOT, "react-app", "public", "data", "voters.json");

/**
 * WHICH COUNTY
 *
 * The sibling repos are named after the county, and the county is whatever
 * voters.json says it is ("{{COUNTY}} County, Ohio" -> "{{COUNTY}}"), so the same
 * script serves every *CountyVoters repo without editing. Not every county has
 * every sibling: a county with no *CountyAddressPoints app is geocoded from
 * parcels alone (tiers 5 and 6 only; lower placement, still a map), and a
 * county with no *CountyJurisdictions app keeps the jurisdiction the converter
 * wrote from the roll's own CITY / TOWNSHIP / VILLAGE columns instead of a
 * point-in-polygon result. Only the parcels repo is required.
 */
console.log(`Reading voters.json ...`);
const data = readJson(VOTERS, "voters");
console.log(`  ${data.voters.length.toLocaleString()} voters`);
const COUNTY = (String(data.county ?? "").match(/^(.+?) County/) ?? [, "Trumbull"])[1].replace(/\s+/g, "");
const sibling = (suffix, file) => join(FLEET, `${COUNTY}County${suffix}`, "react-app", "public", "data", file);
const ADDRESS_POINTS = sibling("AddressPoints", "address-points.json");
const PARCELS = sibling("Parcels", "parcels.json");
const JURISDICTIONS = sibling("Jurisdictions", "jurisdictions.json");

/**
 * How far apart candidate points may be and still count as "the same place",
 * in degrees. 0.004 deg is roughly 400 m - tight enough that picking any of
 * them puts the dot on the right block, loose enough to tolerate a parcel
 * centroid sitting a lot away from an address point on the same lot.
 */
const TIGHT_DEG = 0.004;

/** Tier codes stored per voter in the `geo` field. 0 = not placed. */
export const GEO = {
  NONE: 0,
  EXACT: 1, // street + city/ZIP, full string
  QUADRANT: 2, // same once a trailing N/S/E/W/NE/... is ignored
  NO_TYPE: 3, // same once the street type (RD/ST/AVE/...) is ignored too
  ADDRESS_ELSEWHERE: 4, // address point matches, but under another city/ZIP
  PARCEL: 5, // no address point; a parcel with that address
  PREFIX: 6, // one street name is a prefix of the other (YOUNGSTOWN / YOUNGSTOWN HUBBARD)
};

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
};
const TYPE_SUFFIXES = new Set([
  "RD", "ST", "AVE", "DR", "LN", "CT", "BLVD", "CIR", "PL", "TER", "TRL",
  "PKWY", "HWY", "SQ", "WAY", "RUN", "PT", "LOOP", "PATH", "XING", "PIKE",
]);
// Longest alternatives first so "ST RTE" isn't eaten by the "ST RT" branch.
const ROUTE_RE =
  /\b(?:STATE\s+ROUTE|STATE\s+RTE|STATE\s+RT|ST\s+ROUTE|ST\s+RTE|ST\s+RT|ROUTE|RTE|RT)\b/g;
const UNIT_RE = /\b(?:APT|UNIT|STE|SUITE|LOT|TRLR|RM)\b.*$/;

/** Upper-case token list with units, routes, directionals and types normalized. */
function tokenize(street) {
  let s = String(street ?? "").toUpperCase();
  // Some counties' parcel rolls end the situs address with the state
  // ("5234 US ROUTE 6, OH" in Ashtabula); left in, "OH" becomes part of the
  // street name and nothing matches.
  s = s.replace(/,\s*[A-Z]{2}\s*$/, "");
  // ...and annotate state routes in parentheses: "3703 LAKE (SR 531) RD".
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/#.*$/, "").replace(UNIT_RE, "");
  s = s.replace(ROUTE_RE, "SR");
  // A US route is "US RT 42" on the roll and "RT 42 ST" on Morrow's parcels;
  // Ohio never gives a state route a US route's number, so both are "SR 42".
  s = s.replace(/\bUS\s+(?:HWY\s+)?(?:SR\s+)?(?=\d)/g, "SR ");
  // County and township roads: "CO RD 170" on the roll, "CO 170 RD" from
  // Morrow's auditor, "CR 170" / "TR 134" elsewhere - all "CO RD 170" / "TWP RD 134".
  s = s
    .replace(/\b(?:CO|CR|CTY|COUNTY)\s+(?:RD|ROAD)\s+(\d+)\b/g, "CO RD $1")
    .replace(/\b(?:CO|CTY|COUNTY)\s+(\d+)\s+(?:RD|ROAD)\b/g, "CO RD $1")
    .replace(/\bCR\s+(\d+)\b/g, "CO RD $1")
    .replace(/\b(?:TWP|TR|TOWNSHIP)\s+(?:RD|ROAD)\s+(\d+)\b/g, "TWP RD $1")
    .replace(/\b(?:TWP|TOWNSHIP)\s+(\d+)\s+(?:RD|ROAD)\b/g, "TWP RD $1")
    .replace(/\b(?:TR|TWP)\s+(\d+)\b/g, "TWP RD $1");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => DIRECTIONAL_WORDS[t] ?? t)
    .map((t) => STREET_TYPES[t] ?? t);
}

/** ["3910","E","RIVER","RD","SW"] -> { number: "3910", rest: [...] } */
function splitAddress(street) {
  const t = tokenize(street);
  const number = t.length && /^\d+$/.test(t[0]) ? t[0] : "";
  return { number, rest: number ? t.slice(1) : t };
}

/** Street name with any trailing directionals removed. */
function withoutQuadrant(rest) {
  const r = [...rest];
  while (r.length && DIRECTIONALS.has(r[r.length - 1])) r.pop();
  return r;
}

/** Street name with the trailing directionals AND the type suffix removed. */
function coreName(rest) {
  const r = withoutQuadrant(rest);
  if (r.length && TYPE_SUFFIXES.has(r[r.length - 1])) r.pop();
  while (r.length && DIRECTIONALS.has(r[r.length - 1])) r.pop();
  return r;
}

/**
 * The core name with its leading directional removed too, or null when there
 * is none. Many auditors leave the directional off ("947 LUNDY AVE" for the
 * roll's "947 S LUNDY AV"; Morrow writes "HIGH ST W" for "W HIGH ST"), so a
 * voter whose core finds nothing tries this form - which only reaches parcels
 * that carry NO directional, never "947 N LUNDY", whose core keeps its N.
 */
function coreWithoutLead(core) {
  return core.length > 1 && DIRECTIONALS.has(core[0]) ? core.slice(1) : null;
}

/** True when every candidate sits within TIGHT_DEG of the others. */
function samePlace(points) {
  if (!points || points.length === 0) return false;
  if (points.length === 1) return true;
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return Math.max(latMax - latMin, lonMax - lonMin) < TIGHT_DEG;
}

/** Mean of a candidate set - they're already known to be in the same place. */
function centroid(points) {
  let lat = 0, lon = 0;
  for (const p of points) { lat += p[0]; lon += p[1]; }
  return [
    Number((lat / points.length).toFixed(6)),
    Number((lon / points.length).toFixed(6)),
  ];
}

const push = (map, key, value) => {
  const cur = map.get(key);
  if (cur) cur.push(value);
  else map.set(key, [value]);
};

/** Candidates whose core name is a prefix of the wanted one, or vice versa. */
function prefixMatches(candidates, wanted) {
  if (!candidates || wanted.length === 0) return [];
  const out = [];
  for (const [name, point] of candidates) {
    if (name.length === 0) continue;
    const [short, long] = name.length <= wanted.length ? [name, wanted] : [wanted, name];
    let ok = true;
    for (let i = 0; i < short.length; i++) {
      if (short[i] !== long[i]) { ok = false; break; }
    }
    if (ok) out.push(point);
  }
  return out;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(
      `\nCould not read the ${what} dataset:\n  ${path}\n\n` +
        `This script reads sibling fleet repos from ${FLEET}. Clone or pull the\n` +
        `county's Parcels repo (and AddressPoints / Jurisdictions when it has them) next to this one.\n`,
    );
    throw err;
  }
}

/** A sibling that a county may simply not have: null, and say so, rather than fail. */
function readOptionalJson(path, what) {
  if (existsSync(path)) return readJson(path, what);
  console.log(`No ${what} for ${COUNTY} County (${path}) - continuing without.`);
  return null;
}

// ---------------------------------------------------------------- indexes ---

const addressPoints = readOptionalJson(ADDRESS_POINTS, "address points") ?? [];
console.log(`Reading parcels ...`);
const parcels = readChunked(readJson(PARCELS, "parcels"), PARCELS, "parcels");
console.log(`  ${parcels.length.toLocaleString()} parcels${addressPoints.length ? `, ${addressPoints.length.toLocaleString()} address points` : ""}; indexing ...`);

/**
 * A big county's Parcels app splits its roll into chunks and leaves an index
 * in parcels.json ({ "chunks": ["parcels.0.json", ...], "count": N } - Butler,
 * 165,860 parcels in three files). Follow the index; a plain array is used
 * as it is.
 */
function readChunked(data, indexPath, what) {
  if (Array.isArray(data)) return data;
  if (!data || !Array.isArray(data.chunks)) {
    throw new Error(`${indexPath}: expected an array of ${what} or a { chunks: [...] } index`);
  }
  const dir = dirname(indexPath);
  const all = [];
  for (const chunk of data.chunks) {
    // Not push(...chunk): spreading 165,000 elements overflows the call stack.
    for (const p of readJson(join(dir, chunk), `${what} chunk ${chunk}`)) all.push(p);
  }
  if (data.count && all.length !== data.count) {
    console.warn(`  ${what}: index promises ${data.count} but the chunks hold ${all.length}`);
  }
  return all;
}

/** number + full street name + (city or ZIP) */
const apExact = new Map();
/** number + quadrant-stripped name + (city or ZIP) */
const apQuadrant = new Map();
/** number + core name + (city or ZIP) */
const apCore = new Map();
/** number + core name, geography ignored */
const apAnywhere = new Map();
/** number + ZIP -> [core name tokens, point] for prefix matching */
const apByNumberZip = new Map();

for (const p of addressPoints) {
  const point = [p.y, p.x];
  const { number, rest } = splitAddress(p.a);
  const city = String(p.c ?? "").toUpperCase().trim();
  const zip = String(p.z ?? "");
  const full = rest.join(" ");
  const quad = withoutQuadrant(rest).join(" ");
  const core = coreName(rest);
  const coreStr = core.join(" ");
  for (const geo of [city, zip]) {
    push(apExact, `${number}|${full}|${geo}`, point);
    push(apQuadrant, `${number}|${quad}|${geo}`, point);
    push(apCore, `${number}|${coreStr}|${geo}`, point);
  }
  push(apAnywhere, `${number}|${coreStr}`, point);
  push(apByNumberZip, `${number}|${zip}`, [core, point]);
}

/** The street part of a parcel's site address (see the loop below). */
function parcelStreet(f) {
  const parts = String(f ?? "").split(",")[0].trim().split(/\s{2,}/);
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && /^[A-Z][A-Z .'-]*\s\d{5}(?:-\d{4})?$/i.test(last)) parts.pop();
  return parts.join(" ");
}

/**
 * A parcel that is a double or a small row carries a number range, "1025 -
 * 1027 COLUMBUS ST" (Franklin, 18,645 parcels). Voters live at 1025 and at
 * 1027, so the parcel is indexed under each number in the range - but only
 * short ranges, stepping by two when both ends share a parity (a double);
 * "1 - 99 MAIN ST" is a complex and would place everyone on one dot.
 */
function parcelAddresses(f) {
  const s = parcelStreet(f);
  const m = s.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (!m) return [s];
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!(hi >= lo) || hi - lo > 12) return [s];
  const step = hi !== lo && (hi - lo) % 2 === 0 ? 2 : 1;
  const out = [];
  for (let n = lo; n <= hi; n += step) out.push(`${n} ${m[3]}`);
  return out;
}

/** Parcels carry no street type at all, so only the core forms are useful. */
const pcCore = new Map();
const pcAnywhere = new Map();
const pcByNumberZip = new Map();

for (const p of parcels) {
  if (!p.y || !p.x) continue; // ~half the parcels have no geometry baked in
  // Some counties' parcel layers append the place to the site address:
  // "1344 PITTENGER RD, Weller Township" (Richland) after a comma, or
  // "291  BURNS RD  FAIRFIELD 45014" (Butler) after a double space, with the
  // ZIP last. Only the part before either is the street address.
  for (const addr of parcelAddresses(p.f)) {
    const { number, rest } = splitAddress(addr);
    if (!number) continue;
    const point = [p.y, p.x];
    const zip = String(p.z ?? "");
    const core = coreName(rest);
    const coreStr = core.join(" ");
    push(pcCore, `${number}|${coreStr}|${zip}`, point);
    push(pcAnywhere, `${number}|${coreStr}`, point);
    push(pcByNumberZip, `${number}|${zip}`, [core, point]);
  }
}

// ---------------------------------------------------------------- matching ---

const { cities, zips } = data;

/** Try one tier; returns a [lat, lon] or null. */
function lookup(map, key) {
  const pts = map.get(key);
  return pts && samePlace(pts) ? centroid(pts) : null;
}

const tally = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

console.log(`Placing ${data.voters.length.toLocaleString()} voters ...`);
let done = 0;
const PROGRESS_EVERY = 100_000;
for (const v of data.voters) {
  if (++done % PROGRESS_EVERY === 0) console.log(`  ... ${done.toLocaleString()}`);
  const street = v[4];
  const city = String(cities[v[5]] ?? "").toUpperCase().trim();
  const zip = String(zips[v[6]] ?? "");
  const { number, rest } = splitAddress(street);
  const full = rest.join(" ");
  const quad = withoutQuadrant(rest).join(" ");
  const core = coreName(rest);
  const coreStr = core.join(" ");
  const noLead = coreWithoutLead(core);
  const noLeadStr = noLead ? noLead.join(" ") : null;

  let point = null;
  let tier = GEO.NONE;

  // 1-3: address points, with the geography agreeing. Strictest first.
  //
  // Only tier 1 may take a candidate on faith: an identical full street string
  // in the same city is the same street, and the duplicates are units of one
  // building. Tiers 2 and 3 have thrown information away - "100 MAIN ST NE"
  // and "100 MAIN ST SW" both reduce to "100 MAIN" - so they have to prove the
  // candidates are in one place before they can be trusted.
  for (const [map, form, code] of [
    [apExact, full, GEO.EXACT],
    [apQuadrant, quad, GEO.QUADRANT],
    [apCore, coreStr, GEO.NO_TYPE],
    ...(noLeadStr ? [[apCore, noLeadStr, GEO.NO_TYPE]] : []),
  ]) {
    for (const geo of [city, zip]) {
      const pts = map.get(`${number}|${form}|${geo}`);
      if (!pts) continue;
      if (code === GEO.EXACT) { point = centroid([pts[0]]); tier = code; break; }
      if (samePlace(pts)) { point = centroid(pts); tier = code; break; }
    }
    if (point) break;
  }

  // 4: the address exists, but filed under a different city/ZIP.
  if (!point) {
    const p = lookup(apAnywhere, `${number}|${coreStr}`);
    if (p) { point = p; tier = GEO.ADDRESS_ELSEWHERE; }
  }
  // 5: not an address point at all - fall back to the parcel roll.
  if (!point) {
    const p = lookup(pcCore, `${number}|${coreStr}|${zip}`) ??
              lookup(pcAnywhere, `${number}|${coreStr}`) ??
              (noLeadStr && (lookup(pcCore, `${number}|${noLeadStr}|${zip}`) ??
                             lookup(pcAnywhere, `${number}|${noLeadStr}`)));
    if (p) { point = p; tier = GEO.PARCEL; }
  }
  // 6: one name is a prefix of the other, same house number and ZIP.
  if (!point) {
    for (const byNumberZip of [apByNumberZip, pcByNumberZip]) {
      const pts = prefixMatches(byNumberZip.get(`${number}|${zip}`), core);
      if (samePlace(pts)) { point = centroid(pts); tier = GEO.PREFIX; break; }
    }
  }

  v[10] = point ? point[0] : null;
  v[11] = point ? point[1] : null;
  v[12] = tier;
  tally[tier]++;
}

// ------------------------------------------------------------ jurisdiction ---

/**
 * Ray-casting point-in-polygon, with holes.
 *
 * The app has parcels-core's pointInPolygon.ts vendored for runtime use, but
 * that is TypeScript and this is a plain build script, so the same twenty
 * lines live here rather than adding a compile step to a script that runs
 * three times a year.
 */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
  return true;
}

const jurisdictionGeo = readOptionalJson(JURISDICTIONS, "jurisdiction boundaries");

/** Flattened polygon parts with a bounding box each, so the test is cheap. */
const parts = [];
for (const f of jurisdictionGeo?.features ?? []) {
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly[0]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    parts.push({ name: f.properties.NAME, poly, x0, y0, x1, y1 });
  }
}

// With no boundary file the converter's jurisdictions (from the roll's own
// civil columns) stand, and this pass leaves cell 13 alone.
const fromRoll = !jurisdictionGeo && Array.isArray(data.jurisdictions);
// With one, the boundary decides for every voter it can place - and a voter
// it cannot place (no coordinate, or a coordinate outside every boundary)
// keeps the roll's jurisdiction instead of dropping to "No jurisdiction".
const rollNames = Array.isArray(data.jurisdictions) ? [...data.jurisdictions] : [];
const polygonNames = [...new Set(parts.map((p) => p.name))];
/** Roll name -> the boundary file's spelling: case-insensitive, then a unique prefix ("Weathersf Township"). */
const canonCache = new Map();
function canonical(name) {
  if (!name) return null;
  if (canonCache.has(name)) return canonCache.get(name);
  const lower = name.toLowerCase();
  let hit = polygonNames.find((p) => p.toLowerCase() === lower);
  if (!hit) {
    const w = lower.split(/\s+/);
    const hits = polygonNames.filter((p) => {
      const pw = p.toLowerCase().split(/\s+/);
      return pw.length === w.length && pw.slice(1).join(" ") === w.slice(1).join(" ") && pw[0].startsWith(w[0]);
    });
    if (hits.length === 1) hit = hits[0];
  }
  canonCache.set(name, hit ?? name);
  return hit ?? name;
}
let keptFromRoll = 0;
const jurisdictions = fromRoll ? data.jurisdictions : [];
const jurisdictionIndex = new Map(jurisdictions.map((n, i) => [n, i]));
const indexFor = (name) => {
  let i = jurisdictionIndex.get(name);
  if (i === undefined) {
    i = jurisdictions.length;
    jurisdictions.push(name);
    jurisdictionIndex.set(name, i);
  }
  return i;
};

let outsideEvery = 0;
for (const v of data.voters) {
  if (fromRoll) break;
  const lat = v[10];
  const lon = v[11];
  const fromRollName = canonical(v[13] >= 0 ? rollNames[v[13]] : null);
  if (lat == null || lon == null) {
    // No coordinate: the roll's jurisdiction, when it has one.
    v[13] = fromRollName ? indexFor(fromRollName) : -1;
    if (fromRollName) keptFromRoll++;
    continue;
  }
  let found = -1;
  for (const p of parts) {
    if (lon < p.x0 || lon > p.x1 || lat < p.y0 || lat > p.y1) continue;
    if (inPolygon(lon, lat, p.poly)) {
      found = indexFor(p.name);
      break;
    }
  }
  if (found === -1) {
    outsideEvery++;
    if (fromRollName) { found = indexFor(fromRollName); keptFromRoll++; }
  }
  v[13] = found;
}

// ------------------------------------------------------------------ output ---

const placed = data.voters.length - tally[GEO.NONE];
// convert-voters.mjs already declares the full field order; this only adds the
// lookup table for the indexes just written.
data.jurisdictions = jurisdictions;
data.geocode = {
  sources: [
    addressPoints.length ? `${COUNTY}CountyAddressPoints` : null,
    `${COUNTY}CountyParcels`,
    jurisdictionGeo ? `${COUNTY}CountyJurisdictions` : (fromRoll ? "voter roll (CITY / TOWNSHIP / VILLAGE)" : null),
  ].filter(Boolean),
  placed,
  unplaced: tally[GEO.NONE],
  tiers: {
    exact: tally[GEO.EXACT],
    quadrant: tally[GEO.QUADRANT],
    noType: tally[GEO.NO_TYPE],
    addressElsewhere: tally[GEO.ADDRESS_ELSEWHERE],
    parcel: tally[GEO.PARCEL],
    prefix: tally[GEO.PREFIX],
  },
  jurisdictionsAssigned: data.voters.length - data.voters.filter((v) => v[13] === -1).length,
  placedButOutsideEveryBoundary: outsideEvery,
};

writeFileSync(VOTERS, JSON.stringify(data));

const pct = (n) => `${((n / data.voters.length) * 100).toFixed(1)}%`;
console.log(`Placed ${placed.toLocaleString()} of ${data.voters.length.toLocaleString()} voters (${pct(placed)})`);
for (const [name, code] of Object.entries(GEO)) {
  if (code === GEO.NONE) continue;
  console.log(`  ${name.toLowerCase().padEnd(18)} ${String(tally[code]).padStart(6)}  ${pct(tally[code])}`);
}
console.log(`  ${"unplaced".padEnd(18)} ${String(tally[GEO.NONE]).padStart(6)}  ${pct(tally[GEO.NONE])}`);
const withJurisdiction = data.voters.filter((v) => v[13] !== -1).length;
console.log(
  `Jurisdictions: ${withJurisdiction.toLocaleString()} voters across ` +
    `${jurisdictions.length} ${fromRoll ? "jurisdictions (from the roll)" : "boundaries"}` +
    (outsideEvery ? ` (${outsideEvery} placed but outside every boundary)` : ""),
);
if (keptFromRoll) {
  console.log(`  ${keptFromRoll.toLocaleString()} not placed inside a boundary kept the roll's jurisdiction`);
}
