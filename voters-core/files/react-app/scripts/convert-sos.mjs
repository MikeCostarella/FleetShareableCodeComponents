/**
 * Build react-app/public/data/voters.json from the Ohio Secretary of State's
 * county voter file in SourceData/.
 *
 *   cd react-app && npm run convert:sos      # this, then absentee merge, then geocode
 *   node scripts/convert-sos.mjs             # this step alone
 *   node scripts/convert-sos.mjs --since=2018
 *
 * WHAT THE FILE IS
 *
 * The SoS publishes every county's full registration roll as one CSV (served
 * with a .txt extension):
 *
 *   https://www6.ohiosos.gov/ords/f?p=VOTERFTP:HOME
 *
 * The download is behind an Oracle APEX page that refuses scripted requests,
 * so it is fetched by hand. Save it into SourceData/ as
 *
 *   SourceData/SOS_<COUNTY>_<YYYY-MM-DD>.txt       e.g. SOS_TRUMBULL_2026-10-17.txt
 *
 * where the date is the day it was downloaded. When several are present the
 * latest date wins; older ones can stay for reference.
 *
 * One row per REGISTERED VOTER - not per ballot cast - with the current roll
 * attributes (name, residence, precinct, party, registration date, status)
 * followed by one column per election back to 2000, headed like
 * "GENERAL-11/05/2024". A general's cell holds "X" when the voter cast a
 * ballot; a primary's cell holds the party ballot they took (D, R, L) or "X"
 * for an issues-only ballot; blank means no ballot.
 *
 * WHY THIS REPLACES THE BOARD OF ELECTIONS EXPORTS
 *
 * convert-voters.mjs merges one BOE voter-history spreadsheet per election.
 * Those list only the people who voted, so the dataset was "voters on file",
 * never the roll, and turnout could not be stated as a share of registration.
 * Worse, the BOE exports are .xls, a format that stops at 65,536 rows: the
 * 2024 General export carried 64,885 voters where the SoS file shows 95,022.
 * The whole county had been silently cut off at the letter the sheet ran out
 * on. The SoS file has the entire roll, so both problems go away, and it has
 * the same shape for all 88 counties, which is what a *CountyVoters fleet
 * needs. The absentee merge (convert-absentee.mjs) and the geocoder run on
 * top of this output exactly as they did on the old one.
 *
 * WHAT IS DELIBERATELY NOT WRITTEN
 *
 * The file carries each voter's DATE_OF_BIRTH. The app has never shown one
 * and this converter never reads the column into anything it writes. Mailing
 * addresses and the district columns are not written either; the app has no
 * use for them and the payload is already large.
 *
 * ELECTIONS: WHICH COLUMNS BECOME ELECTIONS
 *
 * Three filters, each printed so a wrong call is visible:
 *
 *   1. --since=YYYY (default 2020). The app stores each voter's history as a
 *      31-bit mask, and the file has ~100 election columns, so a window is
 *      unavoidable. One slot is kept free for the provisional election the
 *      absentee merge adds.
 *   2. A column with no ballots at all in this county is dropped - the SoS
 *      header lists every election date held anywhere in Ohio.
 *   3. A column whose ballots are scattered thinly - fewer than half of them
 *      in precincts at 5%+ turnout - is dropped too. Those are voters who
 *      moved here from a county that held an election this one did not:
 *      their history travels with them, and 99 scattered movers must not
 *      become a "Jun 2024 General" that Trumbull never held. A real local
 *      special (the Feb 2026 Cortland levy, 1,225 voters) is concentrated in
 *      eight precincts at ~30% turnout, so the test separates the two cleanly.
 *
 * Elections that survive are scoped the same way convert-voters.mjs scopes
 * them: a precinct is in an election's scope only if its turnout reaches a
 * share of that election's median precinct turnout, and an election covering
 * most of the county is county-wide and stores no list. See that script for
 * the reasoning; the constants are the same.
 *
 * LABELS
 *
 * The BOE exports were labelled from their filenames ("2025 General",
 * "Feb 2026 Cortland Special"). The SoS gives only a date and a kind, so:
 * a November general is "YYYY General"; the only primary in a year is
 * "YYYY Primary"; everything else carries its month ("Aug 2022 Primary",
 * "Feb 2026 Special"). When a scoped election falls inside a single civil
 * jurisdiction the jurisdiction is added ("Feb 2026 Cortland Special"), read
 * from precinct-boundaries.geojson when it is present. The label "YYYY
 * General" for the coming election must stay free: convert-absentee.mjs
 * refuses to merge an absentee file whose election already exists.
 *
 * PRECINCTS
 *
 * The SoS names precincts "GIRARD CITY 2A"; the BOE roll, the absentee file
 * and precinct-boundaries.geojson use the Board's codes, "GIR 2A.01". The
 * geojson is the crosswalk: each feature's `vtd` is the SoS name and its
 * `precincts` are the BOE code(s) it contains. Where a VTD holds one code
 * the mapping is exact. Thirty Trumbull VTDs are split into .01/.02 codes
 * the SoS does not distinguish, so for those the voter's code is taken from
 * the previous voters.json when it had this voter in one of the candidate
 * codes, failing that from neighbours on the same street and ZIP, and
 * failing that the bare code ("GIR 2A") is kept - the same fallback the
 * absentee merge uses. One SoS name ("MESPO TWP A") abbreviates a township
 * the geojson spells out; a guarded prefix match handles it and says so.
 *
 * Without a geojson (a county whose Voters app is new) the SoS name is the
 * precinct, which is honest and works everywhere except the boundary layer.
 *
 * JURISDICTION
 *
 * The roll says which city, village or township each voter is in (the CITY,
 * TOWNSHIP and VILLAGE columns), so the jurisdiction cell is filled here, named
 * the way the fleet's boundary files name them ("Girard", "Howland Township").
 * In a county with a *CountyJurisdictions app the geocoder replaces it with
 * the point-in-polygon result, as before; in a county without one it stands.
 *
 * STATUS
 *
 * VOTER_STATUS is ACTIVE or CONFIRMATION (a confirmation notice was sent and
 * not answered; the voter is still registered). It is written as a 16th cell
 * so turnout can be stated against active registration; 17,884 of Trumbull's
 * 131,468 voters were on confirmation status in October 2026.
 *
 * Output is column-indexed - precinct, city, ZIP, party and status become
 * indexes into lookup tables - and the row layout is the one loadVoters.ts
 * reads, with the geocode cells left empty for geocode-voters.mjs to fill.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SOURCE_DIR = join(ROOT, "SourceData");
const DATA_DIR = join(ROOT, "react-app", "public", "data");
const OUT = join(DATA_DIR, "voters.json");
const BOUNDARIES = join(DATA_DIR, "precinct-boundaries.geojson");

// --------------------------------------------------------------- arguments ---

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
/** Earliest election year kept. */
const SINCE = Number(args.since ?? 2020);
if (!Number.isInteger(SINCE) || SINCE < 2000) throw new Error(`--since must be a year >= 2000, got "${args.since}"`);

// --------------------------------------------------------------- constants ---

/** 31 bits in the mask; one is reserved for the absentee merge's provisional election. */
const MAX_ELECTIONS = 30;

/**
 * An election is kept only when at least MIN_CONCENTRATED_SHARE of its
 * ballots were cast in precincts whose turnout reaches MIN_PRECINCT_TURNOUT.
 * Movers' imported history scatters a few voters over many precincts (well
 * under 1% each); a real local ballot concentrates at 10-40% in the precincts
 * that held it. A share rather than a single peak, because an unresolved
 * split code can hold a handful of voters, and one ballot there is already a
 * "high" rate; such a precinct cannot carry half an election's ballots.
 */
const MIN_PRECINCT_TURNOUT = 0.05;
const MIN_CONCENTRATED_SHARE = 0.5;

/** Same scope constants as convert-voters.mjs. */
const COUNTY_WIDE_SHARE = 0.8;
const SCOPE_MIN_SHARE_OF_MEDIAN = 0.2;

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * RFC-4180 CSV reader that STREAMS: the file is read in 4 MB pieces and each
 * finished row is handed to `onRow(row, index)` and then dropped. The SoS file
 * for Franklin is 537 MB - as one JS string plus 905,000 field arrays that is
 * more than a 4 GB machine has, and Cuyahoga and Hamilton are the same size.
 * Quoted fields, doubled quotes and CRLF as before; a quoted field may span a
 * chunk boundary, since the parser state carries across reads.
 */
function readCsvRows(path, onRow) {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(4 * 1024 * 1024);
  let row = [];
  let field = "";
  let quoted = false;
  let index = 0;
  let pendingCR = false;
  let pendingQuote = false; // a '"' closed a chunk; is the next char another '"'?
  let first = true;
  let carry = Buffer.alloc(0); // bytes of an incomplete UTF-8 sequence at a chunk's end
  const emit = () => {
    row.push(field); field = "";
    if (row.length > 1 || row[0] !== "") onRow(row, index++);
    row = [];
  };
  for (;;) {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n === 0) break;
    const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
    // Don't split a multi-byte character: hold back a trailing partial sequence.
    let end = chunk.length;
    for (let k = 1; k <= 3 && k <= chunk.length; k++) {
      const b = chunk[chunk.length - k];
      if ((b & 0xC0) === 0x80) continue;
      const need = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1;
      if (need > k) end = chunk.length - k;
      break;
    }
    carry = Buffer.from(chunk.subarray(end));
    let text = chunk.toString("utf8", 0, end);
    if (first) { text = text.replace(/^\uFEFF/, ""); first = false; }
    let i = 0;
    if (pendingQuote) {
      pendingQuote = false;
      if (text[0] === '"') { field += '"'; i = 1; } else quoted = false;
    }
    for (; i < text.length; i++) {
      const c = text[i];
      if (pendingCR) { pendingCR = false; if (c === "\n") continue; }
      if (quoted) {
        if (c === '"') {
          if (i + 1 === text.length) { pendingQuote = true; }
          else if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") emit();
      else if (c === "\r") { emit(); pendingCR = true; }
      else field += c;
    }
  }
  closeSync(fd);
  if (pendingQuote) quoted = false;
  if (field !== "" || row.length) emit();
  return index;
}

// ------------------------------------------------------------- the source ---

/** "SOS_TRUMBULL_2026-10-17.txt" -> { county: "Trumbull", date: "2026-10-17" } */
function describeSosFile(file) {
  const m = basename(file).match(/^SOS_([A-Z][A-Z _-]*?)_(\d{4}-\d{2}-\d{2})\.(txt|csv)$/i);
  if (!m) return null;
  const county = m[1].toLowerCase().split(/[ _-]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return { file: basename(file), county, date: m[2] };
}

let source;
if (args.file) {
  source = describeSosFile(args.file);
  if (!source) throw new Error(`--file must be named like SOS_TRUMBULL_2026-10-17.txt, got "${args.file}"`);
  source.path = resolve(args.file);
} else {
  const found = readdirSync(SOURCE_DIR).map(describeSosFile).filter(Boolean);
  if (found.length === 0) {
    throw new Error(
      `No SoS voter file in ${SOURCE_DIR}.\n` +
        `Download the county file from https://www6.ohiosos.gov/ords/f?p=VOTERFTP:HOME and save it as\n` +
        `  SourceData/SOS_<COUNTY>_<YYYY-MM-DD>.txt   (e.g. SOS_TRUMBULL_2026-10-17.txt)`,
    );
  }
  found.sort((a, b) => a.date.localeCompare(b.date));
  source = found[found.length - 1];
  source.path = join(SOURCE_DIR, source.file);
  if (found.length > 1) {
    console.log(`${found.length} SoS files found; using the latest, ${source.file}`);
  }
}
const COUNTY_LABEL = args.county ?? `${source.county} County, Ohio`;

console.log(`Reading ${source.file} (${COUNTY_LABEL}, downloaded ${source.date})`);
// Pass 1: the header only. Pass 2 (below, once the column indexes and the
// crosswalk are ready) streams the voter rows.
let header = null;
{
  const fd = openSync(source.path, "r");
  const buf = Buffer.alloc(256 * 1024);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const firstLine = buf.toString("utf8", 0, n).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const cells = []; let f = ""; let q = false;
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i];
    if (q) { if (c === '"') { if (firstLine[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { cells.push(f); f = ""; } else f += c;
  }
  cells.push(f);
  header = cells.map(squash);
}
const col = (name) => {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Column "${name}" not found in ${source.file}; is this an SoS voter file?`);
  return i;
};
const C = {
  id: col("COUNTY_ID"),
  last: col("LAST_NAME"),
  first: col("FIRST_NAME"),
  middle: col("MIDDLE_NAME"),
  suffix: col("SUFFIX"),
  registered: col("REGISTRATION_DATE"),
  status: col("VOTER_STATUS"),
  party: col("PARTY_AFFILIATION"),
  addr1: col("RESIDENTIAL_ADDRESS1"),
  addr2: col("RESIDENTIAL_SECONDARY_ADDR"),
  city: col("RESIDENTIAL_CITY"),
  zip: col("RESIDENTIAL_ZIP"),
  precinct: col("PRECINCT_NAME"),
  // Civil jurisdiction, as the Board has it: "YOUNGSTOWN CITY", "BOARDMAN TWP"
  // (Trumbull writes "HOWLAND TWP ONLY"), "SEBRING VILLAGE".
  civilCity: col("CITY"),
  township: col("TOWNSHIP"),
  village: col("VILLAGE"),
};
// DATE_OF_BIRTH is in the header and is intentionally never indexed.

/** Every election column, with its date. Oldest first. */
const allElectionCols = [];
header.forEach((h, i) => {
  const m = h.match(/^(PRIMARY|GENERAL|SPECIAL)-(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return;
  allElectionCols.push({
    col: i,
    season: m[1].toLowerCase(),
    month: Number(m[2]),
    day: Number(m[3]),
    year: Number(m[4]),
    date: `${m[4]}-${m[2]}-${m[3]}`,
  });
});
allElectionCols.sort((a, b) => a.date.localeCompare(b.date));
const windowCols = allElectionCols.filter((e) => e.year >= SINCE);
console.log(
  `  ${allElectionCols.length} election columns ` +
    `(${allElectionCols[0]?.date} .. ${allElectionCols[allElectionCols.length - 1]?.date}), ` +
    `${windowCols.length} from ${SINCE} on`,
);

// --------------------------------------------------------- the crosswalk ---

/** SoS precinct name -> BOE code(s), from the boundary file when there is one. */
let vtdCodes = null;
let vtdJurisdiction = null;
if (existsSync(BOUNDARIES)) {
  const g = JSON.parse(readFileSync(BOUNDARIES, "utf8"));
  vtdCodes = new Map();
  vtdJurisdiction = new Map();
  for (const f of g.features) {
    const { vtd, precincts, jurisdiction } = f.properties ?? {};
    if (!vtd || !Array.isArray(precincts)) continue;
    vtdCodes.set(squash(vtd), precincts.map(squash));
    if (jurisdiction) vtdJurisdiction.set(squash(vtd), jurisdiction);
  }
  console.log(`  precinct crosswalk: ${vtdCodes.size} VTDs in ${basename(BOUNDARIES)}`);
} else {
  console.log(`  no ${basename(BOUNDARIES)} - SoS precinct names are used as-is`);
}

/**
 * The previous dataset, if any, read before it is overwritten: it settles
 * split precincts for voters it already placed, and lends its street ->
 * precinct knowledge for the rest.
 */
let prior = null;
if (existsSync(OUT)) {
  try {
    const p = JSON.parse(readFileSync(OUT, "utf8"));
    if (Array.isArray(p.voters) && Array.isArray(p.precincts)) prior = p;
  } catch {
    // unreadable prior is the same as none
  }
}
const priorPrecinctById = new Map();
const priorPrecinctByStreet = new Map(); // "street name|zip" -> Set of codes
const streetKey = (street, zip) =>
  `${squash(street).replace(/^\d+\S*\s+/, "").replace(/#.*$/, "").trim()}|${zip}`;
if (prior) {
  for (const v of prior.voters) {
    const code = prior.precincts[v[1]];
    if (!code) continue;
    priorPrecinctById.set(v[0], code);
    const k = streetKey(v[4], prior.zips[v[6]]);
    let set = priorPrecinctByStreet.get(k);
    if (!set) { set = new Set(); priorPrecinctByStreet.set(k, set); }
    set.add(code);
  }
  console.log(`  prior voters.json: ${prior.voters.length.toLocaleString()} voters consulted for split precincts`);
}

const aliasNotes = new Map(); // SoS name -> geojson vtd it was matched to
/** Candidate BOE codes for an SoS precinct name, or null when there is no crosswalk entry. */
function codesFor(sosName) {
  if (!vtdCodes) return null;
  const exact = vtdCodes.get(sosName);
  if (exact) return exact;
  const known = aliasNotes.get(sosName);
  if (known !== undefined) return known ? vtdCodes.get(known) : null;
  // "MESPO TWP A" vs "MESOPOTAMIA TWP A": everything after the place name is
  // identical and the place names share their first three letters. Only a
  // unique hit counts, and every match is printed.
  const toks = sosName.split(" ");
  const hits = [...vtdCodes.keys()].filter((vtd) => {
    const t = vtd.split(" ");
    if (t.length !== toks.length) return false;
    if (t.slice(1).join(" ") !== toks.slice(1).join(" ")) return false;
    return t[0].slice(0, 3) === toks[0].slice(0, 3);
  });
  aliasNotes.set(sosName, hits.length === 1 ? hits[0] : "");
  return hits.length === 1 ? vtdCodes.get(hits[0]) : null;
}

const precinctStats = { asIs: 0, exact: 0, byPrior: 0, byNeighbours: 0, bare: 0, unmapped: new Map() };
function resolvePrecinct(sosName, id, street, zip) {
  const candidates = codesFor(sosName);
  if (!candidates) {
    if (vtdCodes) precinctStats.unmapped.set(sosName, (precinctStats.unmapped.get(sosName) ?? 0) + 1);
    precinctStats.asIs++;
    // Some counties prefix every name with the word ("PRECINCT AUS 1"); it says nothing.
    return sosName.replace(/^PRECINCT\s+/, "");
  }
  if (candidates.length === 1) { precinctStats.exact++; return candidates[0]; }
  const was = priorPrecinctById.get(id);
  if (was && candidates.includes(was)) { precinctStats.byPrior++; return was; }
  const near = priorPrecinctByStreet.get(streetKey(street, zip));
  if (near) {
    const hits = candidates.filter((c) => near.has(c));
    if (hits.length === 1) { precinctStats.byNeighbours++; return hits[0]; }
  }
  precinctStats.bare++;
  return squash(candidates[0].replace(/\.\d*$/, ""));
}

// ----------------------------------------------------------- jurisdiction ---

/** "NEW MIDDLETOWN" -> "New Middletown"; "MCDONALD" -> "McDonald". */
function titleCase(s) {
  return squash(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`)
    // "Geneva-On-The-Lake" -> "Geneva-on-the-Lake", as the boundary files spell it.
    .replace(/-(On|The|Of)(?=-)/g, (m) => m.toLowerCase());
}

/**
 * The voter's civil jurisdiction from the roll's own columns, named the way
 * the fleet's *CountyJurisdictions boundaries name them: a city or village by
 * its bare name ("Girard", "McDonald"), a township as "Howland Township". A
 * village or city inside a township is the village or city.
 */
function jurisdictionOf(row) {
  const village = squash(row[C.village]).replace(/\s+VILLAGE$/i, "");
  if (village) return titleCase(village);
  const city = squash(row[C.civilCity]).replace(/\s+CITY$/i, "");
  if (city) return titleCase(city);
  const twp = squash(row[C.township]).replace(/\s+ONLY$/i, "").replace(/\s+(TWP|TOWNSHIP)$/i, "");
  if (twp) return `${titleCase(twp)} Township`;
  return jurisdictionFromPrecinct(row[C.precinct]);
}

/**
 * Some Boards leave CITY / TOWNSHIP / VILLAGE empty for every voter (Cuyahoga,
 * Oct 2026) but name their precincts after the municipality: "BRECKSVILLE-00-G",
 * "OLMSTED TOWNSHIP-01-A", "WARRENSVILLE HTS-02-B", "CHAGRIN FALLS TWP-00-A".
 * The part before the first "-NN-" is the jurisdiction. Only reached when the
 * three columns are blank, so counties that fill them are unaffected.
 */
function jurisdictionFromPrecinct(precinct) {
  const m = squash(precinct).match(/^(.*?)\s*-\s*\d\d-/);
  if (!m) return "";
  let name = m[1].trim().replace(/\s+VILLAGE$/i, "").replace(/\s+CITY$/i, "");
  const twp = name.match(/^(.*?)\s+(TWP|TOWNSHIP)$/i);
  if (twp) return `${titleCase(twp[1])} Township`;
  name = name.replace(/\bHTS$/i, "HEIGHTS");
  return titleCase(name);
}

// ---------------------------------------------------------------- voters ---

/** id -> { attrs, votes: Set of window column indexes } */
const voters = new Map();
const statusCounts = new Map();
const partyCounts = new Map();
let duplicates = 0;
let badRows = 0;

const rowCount = readCsvRows(source.path, (row, r) => {
  if (r === 0) return; // the header
  if (row.length !== header.length) { badRows++; return; }
  const id = Number(squash(row[C.id]));
  if (!Number.isInteger(id)) { badRows++; return; }

  const addr2 = squash(row[C.addr2]);
  const street = squash(row[C.addr1]) + (addr2 ? ` # ${addr2}` : "");
  const zip = squash(row[C.zip]).slice(0, 5);
  const sosPrecinct = squash(row[C.precinct]);
  const status = squash(row[C.status]) || "UNKNOWN";
  const party = squash(row[C.party]) || "--";
  statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  partyCounts.set(party, (partyCounts.get(party) ?? 0) + 1);

  const votes = [];
  for (let k = 0; k < windowCols.length; k++) {
    if (squash(row[windowCols[k].col]) !== "") votes.push(k);
  }

  const attrs = {
    lastName: squash(row[C.last]),
    // The BOE convention the app was built on: suffix leads the given names.
    firstName: [squash(row[C.suffix]), squash(row[C.first]), squash(row[C.middle])].filter(Boolean).join(" "),
    street,
    city: squash(row[C.city]),
    zip,
    registered: squash(row[C.registered]).slice(0, 10),
    party,
    status,
    sosPrecinct,
    precinct: resolvePrecinct(sosPrecinct, id, street, zip),
    jurisdiction: jurisdictionOf(row),
  };
  if (voters.has(id)) duplicates++;
  voters.set(id, { attrs, votes });
}) - 1;
console.log(`  ${rowCount.toLocaleString()} rows; ${voters.size.toLocaleString()} distinct voters (${badRows} malformed rows, ${duplicates} duplicate IDs)`);

// ------------------------------------------------------------- elections ---

// Registration and turnout per precinct, per window column.
const precinctSize = new Map();
const hits = windowCols.map(() => new Map());
for (const { attrs, votes } of voters.values()) {
  const p = attrs.precinct;
  precinctSize.set(p, (precinctSize.get(p) ?? 0) + 1);
  for (const k of votes) hits[k].set(p, (hits[k].get(p) ?? 0) + 1);
}

const dropped = { empty: [], movers: [] };
const kept = [];
windowCols.forEach((e, k) => {
  let total = 0;
  let concentrated = 0;
  for (const [p, n] of hits[k]) {
    total += n;
    if (n / precinctSize.get(p) >= MIN_PRECINCT_TURNOUT) concentrated += n;
  }
  if (total === 0) { dropped.empty.push({ ...e, total }); return; }
  const share = concentrated / total;
  if (share < MIN_CONCENTRATED_SHARE) { dropped.movers.push({ ...e, total, share }); return; }
  kept.push({ ...e, k, total, share });
});

if (kept.length > MAX_ELECTIONS) {
  const years = [...new Set(kept.map((e) => e.year))];
  throw new Error(
    `${kept.length} elections since ${SINCE}, but the mask holds ${MAX_ELECTIONS} ` +
      `(31 bits, one kept for the absentee merge). Re-run with a later --since; ` +
      `years present: ${years.join(", ")}.`,
  );
}

// Scope, as in convert-voters.mjs.
const allPrecincts = new Set(precinctSize.keys());
for (const e of kept) {
  const seen = [];
  for (const [p, size] of precinctSize) {
    const n = hits[e.k].get(p) ?? 0;
    if (n > 0) seen.push({ precinct: p, rate: n / size, voters: n });
  }
  seen.sort((a, b) => a.rate - b.rate);
  const median = seen.length ? seen[Math.floor(seen.length / 2)].rate : 0;
  const floor = median * SCOPE_MIN_SHARE_OF_MEDIAN;
  e.medianTurnout = median;
  e.turnoutFloor = floor;
  e.strays = seen.filter((s) => s.rate < floor);
  e.scopeSet = new Set(seen.filter((s) => s.rate >= floor).map((s) => s.precinct));
  e.precinctShare = allPrecincts.size ? e.scopeSet.size / allPrecincts.size : 1;
  e.countyWide = e.precinctShare >= COUNTY_WIDE_SHARE;
  e.scope = e.countyWide ? null : [...e.scopeSet].sort();
}

/** "City of Cortland" -> "Cortland"; "Howland Township" -> "Howland Twp". */
function shortJurisdiction(j) {
  return squash(j)
    .replace(/^(City|Village) of /i, "")
    .replace(/ Township$/i, " Twp");
}

/** Jurisdiction qualifier for a scoped election when all its precincts share one. */
function qualifierFor(e) {
  if (e.countyWide || !vtdJurisdiction) return "";
  // Map scope codes back to the SoS names they came from, then to jurisdictions.
  const names = new Set();
  for (const { attrs } of voters.values()) {
    if (e.scopeSet.has(attrs.precinct)) names.add(attrs.sosPrecinct);
  }
  const js = new Set();
  for (const n of names) {
    const vtd = vtdCodes.has(n) ? n : aliasNotes.get(n);
    const j = vtd ? vtdJurisdiction.get(vtd) : null;
    js.add(j ?? "?");
  }
  return js.size === 1 && !js.has("?") ? shortJurisdiction([...js][0]) : "";
}

// Labels: regular elections get the BOE-style short label; the rest carry a month.
const primariesByYear = new Map();
for (const e of kept) if (e.season === "primary") primariesByYear.set(e.year, (primariesByYear.get(e.year) ?? 0) + 1);
for (const e of kept) {
  const title = e.season[0].toUpperCase() + e.season.slice(1);
  const regular =
    (e.season === "general" && e.month === 11) ||
    (e.season === "primary" && primariesByYear.get(e.year) === 1);
  e.qualifier = qualifierFor(e);
  e.label = [regular ? "" : MONTH_NAMES[e.month], String(e.year), e.qualifier, title].filter(Boolean).join(" ");
  e.id = [e.year, String(e.month).padStart(2, "0"), e.season, e.qualifier.toLowerCase().replace(/\s+/g, "-")]
    .filter(Boolean).join("-");
}
// Two kept elections in the same month and kind are told apart by day.
const byLabel = new Map();
for (const e of kept) byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + 1);
for (const e of kept) {
  if (byLabel.get(e.label) > 1) {
    e.label = e.label.replace(String(e.year), `${e.day} ${e.year}`);
    e.id = e.id.replace(`${e.year}-${String(e.month).padStart(2, "0")}`, e.date);
  }
}

// ---------------------------------------------------------------- output ---

const precincts = [];
const cities = [];
const zips = [];
const parties = [];
const statuses = [];
const jurisdictions = [];
const indexOf = (list, value) => {
  const i = list.indexOf(value);
  if (i !== -1) return i;
  list.push(value);
  return list.length - 1;
};

const bitByColumn = new Map(kept.map((e, bit) => [e.k, bit]));
const outVoters = [];
for (const [id, { attrs, votes }] of voters) {
  let mask = 0;
  for (const k of votes) {
    const bit = bitByColumn.get(k);
    if (bit !== undefined) mask |= 1 << bit;
  }
  outVoters.push([
    id,
    indexOf(precincts, attrs.precinct),
    attrs.lastName,
    attrs.firstName,
    attrs.street,
    indexOf(cities, attrs.city),
    indexOf(zips, attrs.zip),
    attrs.registered,
    indexOf(parties, attrs.party),
    mask,
    null, null, 0, // lat, lon, geo tier - geocode-voters.mjs fills these
    // Jurisdiction from the roll. Where the county has a *CountyJurisdictions
    // boundary file the geocoder replaces this with the point-in-polygon result.
    attrs.jurisdiction ? indexOf(jurisdictions, attrs.jurisdiction) : -1,
    0, // ballot - convert-absentee.mjs fills this
    indexOf(statuses, attrs.status),
  ]);
}
outVoters.sort((a, b) => a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]) || a[0] - b[0]);

const data = {
  county: COUNTY_LABEL,
  runDate: new Date().toISOString().slice(0, 10),
  count: outVoters.length,
  /** Where the roll came from. `kind` tells the app this is the full registration roll. */
  source: {
    kind: "sos",
    file: source.file,
    asOf: source.date,
    since: SINCE,
    registered: outVoters.length,
    active: statusCounts.get("ACTIVE") ?? 0,
  },
  elections: kept.map((e) => ({
    id: e.id,
    label: e.label,
    year: e.year,
    season: e.season,
    month: e.month,
    /** Election day, ISO - the SoS column header. */
    date: e.date,
    sourceFile: source.file,
    voters: e.total,
    countyWide: e.countyWide,
    scope: e.scope,
  })),
  fields: [
    "id", "precinct", "lastName", "firstName", "street", "city", "zip",
    "registered", "party", "elections", "lat", "lon", "geo", "jurisdiction",
    "ballot", "status",
  ],
  precincts,
  cities,
  zips,
  parties,
  statuses,
  jurisdictions,
  voters: outVoters,
};

mkdirSync(DATA_DIR, { recursive: true });
const json = JSON.stringify(data);
writeFileSync(OUT, json);

// ---------------------------------------------------------------- report ---

const pad = (n) => n.toLocaleString().padStart(8);
console.log(`\n${COUNTY_LABEL}: ${outVoters.length.toLocaleString()} registered voters`);
for (const [s, n] of [...statusCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(13)} ${pad(n)}`);
console.log("  party:");
for (const [p, n] of [...partyCounts].sort((a, b) => b[1] - a[1])) console.log(`    ${p.padEnd(3)} ${pad(n)}`);

console.log(`\n${kept.length} elections kept (bit 0 first):`);
for (const e of kept) {
  const scope = e.countyWide
    ? "county-wide"
    : `${e.scopeSet.size} of ${allPrecincts.size} precincts (${(e.precinctShare * 100).toFixed(0)}%)`;
  console.log(
    `  ${e.date}  ${e.label.padEnd(28)} ${pad(e.total)}  ` +
      `${(e.total / outVoters.length * 100).toFixed(1).padStart(5)}% of roll  ${scope}`,
  );
}
if (dropped.movers.length) {
  console.log(
    `\n  Dropped - ballots cast elsewhere by voters who have since moved here ` +
      `(under ${MIN_CONCENTRATED_SHARE * 100}% of ballots in precincts at ${MIN_PRECINCT_TURNOUT * 100}%+ turnout):`,
  );
  for (const e of dropped.movers) {
    console.log(`    ${e.date}  ${e.season.padEnd(8)} ${pad(e.total)} voters, ${(e.share * 100).toFixed(0)}% concentrated`);
  }
}
if (dropped.empty.length) {
  console.log(`\n  Dropped - no ballots in this county: ${dropped.empty.map((e) => e.date).join(", ")}`);
}
const withStrays = kept.filter((e) => e.strays.length);
if (withStrays.length) {
  console.log("\n  Left out of scope - turnout far below the election's median:");
  for (const e of withStrays) {
    const n = e.strays.reduce((a, s) => a + s.voters, 0);
    const worst = e.strays[e.strays.length - 1];
    console.log(
      `    ${e.label.padEnd(28)} ${String(e.strays.length).padStart(3)} precincts, ${String(n).padStart(5)} voters ` +
        `(median ${(e.medianTurnout * 100).toFixed(1)}%, floor ${(e.turnoutFloor * 100).toFixed(1)}%, ` +
        `highest dropped ${worst.precinct} at ${(worst.rate * 100).toFixed(2)}%)`,
    );
  }
}

const noJurisdiction = outVoters.filter((v) => v[13] === -1).length;
console.log(
  `\n  jurisdictions: ${jurisdictions.length} from the roll's CITY / TOWNSHIP / VILLAGE columns` +
    (noJurisdiction ? ` (${noJurisdiction.toLocaleString()} voters with none)` : ""),
);
console.log("\n  precincts:");
if (vtdCodes) {
  console.log(`    ${pad(precinctStats.exact)} in a VTD with one BOE code`);
  console.log(`    ${pad(precinctStats.byPrior)} split VTD, code kept from the previous voters.json`);
  console.log(`    ${pad(precinctStats.byNeighbours)} split VTD, settled by neighbours on the same street`);
  console.log(`    ${pad(precinctStats.bare)} split VTD, unresolved - bare code kept`);
  if (precinctStats.asIs) console.log(`    ${pad(precinctStats.asIs)} no crosswalk entry - SoS name kept`);
  for (const [sos, vtd] of aliasNotes) {
    if (vtd) console.log(`    "${sos}" matched to "${vtd}" by prefix`);
  }
  for (const [sos, n] of precinctStats.unmapped) console.log(`    ! "${sos}" (${n} voters) is not in ${basename(BOUNDARIES)}`);
} else {
  console.log(`    ${pad(precinctStats.asIs)} voters in ${precincts.length} SoS-named precincts (no crosswalk)`);
}

console.log(`\nWrote ${OUT} (${(Buffer.byteLength(json) / 1048576).toFixed(1)} MB)`);
console.log("Run `node scripts/convert-absentee.mjs` then `npm run geocode` next.");
