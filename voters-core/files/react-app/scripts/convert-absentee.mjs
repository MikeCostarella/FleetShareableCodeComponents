/**
 * Merge the Board of Elections ABSENTEE / EARLY VOTING file into
 * react-app/public/data/voters.json, as a provisional election.
 *
 *   cd react-app && npm run convert     # convert-voters, this, then geocode
 *   node scripts/convert-absentee.mjs   # this step alone (re-run geocode after)
 *
 * WHAT THE FILE IS
 *
 * While early voting is open, the BOE publishes a daily download of every
 * absentee and early ballot ISSUED for the coming election - who asked for a
 * ballot (or walked in and voted), when it went out, and when it came back:
 *
 *   https://boe.co.trumbull.oh.gov/boe_earlyvote.html
 *   "ABSENTEE VOTER DOWNLOAD FILE - CSV File"
 *
 * Save it into SourceData/ with the election in the name, the same way the
 * voter-history exports are named, plus the word "absentee":
 *
 *   SourceData/TrumbullCounty_absentee 2026 general.csv
 *
 * It is a DIFFERENT kind of record from the voter-history exports the main
 * converter reads. Those list the people who voted in a finished election.
 * This lists ballots in flight: a ballot that has been RETURNED is a vote; a
 * ballot that is out but not back is not. So the file becomes one more
 * election in the dataset - marked `provisional` - where the election bit is
 * set only for returned ballots, and every voter in the file also carries a
 * `ballot` record (category, issued, returned) so the app can show the
 * "ballot out, not back" state the finished exports never have.
 *
 * When the election is over and the BOE's normal voter-history export for it
 * lands in SourceData/, delete this CSV. The provisional election and the
 * ballot records disappear on the next `npm run convert`, and the official
 * export takes over under the same label.
 *
 * ONE ROW PER BALLOT, NOT PER VOTER
 *
 * A ballot that was reissued (a corrected care-of address, a spoiled ballot)
 * shows up twice. Rows are keyed on the BOE voter ID and the LATEST issue
 * wins; a returned date on any row counts as returned.
 *
 * TWO FILE SHAPES
 *
 * Ohio counties publish this file in one of two shapes, and scripts/lib/
 * absentee.mjs reads both, telling them apart by whether the first row is a
 * header: Trumbull's VoterView export (described below) and the state
 * platform's CSV (lookup.boe.ohio.gov/vtrapp/<county>/avreport.aspx, used by
 * Mahoning and ~70 other counties - one row per voter, a real header, and a
 * ballot status that can flag a returned ballot with a problem). Everything
 * from the ballot records on is the same for both.
 *
 * THE VOTERVIEW CSV IS A REPORT, NOT A TABLE
 *
 * Every row repeats the column headings in its first nine cells, and the
 * right-hand "Total:" column repeats the row count. Worse, the columns shift
 * by one when a ballot was mailed in care of someone: cell 9 is normally
 * blank and cell 10 is the voter's name, but on a care-of row cell 9 is the
 * voter and cell 10 is the care-of line. Everything from cell 11 on is in the
 * same place either way.
 *
 * VOTERS WHO ARE NOT ON FILE YET
 *
 * Most voters in the file (93% in October 2026) are already in voters.json
 * from an earlier election, and for those ONLY the election bit and the
 * ballot record are added: their name, address and precinct stay as the
 * roll export gave them, which is authoritative. The rest - people whose
 * first vote on file is this one, often newly registered - are added from
 * the absentee file itself, with three honest limitations:
 *
 *   - The file gives the MAILING address, not the residence. Where that is a
 *     Trumbull County street (nearly always) it is used as the street, and
 *     the geocoder places it like any other. An e-mail address (UOCAVA
 *     voters get their ballot electronically) or an out-of-state address is
 *     NOT a residence: those voters are stored with no street, and an
 *     out-of-state mailing city keeps its state ("FAIRMONT, WV"). E-mail
 *     addresses are never written to the output.
 *   - The name is one "FIRST MIDDLE LAST" string, split on the last word
 *     (a trailing JR / SR / II / III / IV moves to the front of the given
 *     names, the convention the roll exports use). Two-word surnames will be
 *     split wrong until the official export replaces them.
 *   - The precinct code is written without the roll's trailing "." and
 *     without the ".01/.02" split suffix. It is matched to the roll's codes;
 *     where the roll has a split precinct the voter's neighbours on the same
 *     street settle it, and if they can't the bare code is kept.
 *
 * There is no registration date in this file.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BALLOT_CATEGORIES, readBallots, latestDate, squash } from "./lib/absentee.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SOURCE_DIR = join(ROOT, "SourceData");
const OUT = join(ROOT, "react-app", "public", "data", "voters.json");

/** Ohio generals are the first Tuesday after the first Monday in November. */
function generalElectionDate(year) {
  const d = new Date(year, 10, 1);
  const firstMonday = 1 + ((8 - d.getDay()) % 7);
  return `${year}-11-${String(firstMonday + 1).padStart(2, "0")}`;
}

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const SEASONS = /^(primary|general|special)$/;
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEASON_MONTH = { primary: 5, special: 6, general: 11 };

/**
 * "TrumbullCounty_absentee 2026 general.csv" -> election descriptor, using the
 * same filename grammar as convert-voters.mjs so the label comes out identical
 * to the one the official export will carry later.
 */
function electionFromFilename(file) {
  const base = file.replace(/\.csv$/i, "");
  const words = base.split(/[\s_\-]+/).filter(Boolean);
  let year = null, season = null, month = null;
  const rest = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (year === null && /^(19|20)\d{2}$/.test(lower)) { year = Number(lower); continue; }
    if (season === null && SEASONS.test(lower)) { season = lower; continue; }
    if (month === null && MONTHS[lower] !== undefined) { month = MONTHS[lower]; continue; }
    if (lower === "absentee" || lower === "voted" || /county$/.test(lower)) continue;
    rest.push(w);
  }
  if (year === null || season === null) return null;
  const title = season[0].toUpperCase() + season.slice(1);
  const qualifier = rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  const label = [month ? MONTH_NAMES[month] : "", String(year), qualifier, title]
    .filter(Boolean).join(" ");
  const sortMonth = month ?? SEASON_MONTH[season];
  return {
    id: [year, String(sortMonth).padStart(2, "0"), season, qualifier.toLowerCase().replace(/\s+/g, "-")]
      .filter(Boolean).join("-"),
    label, year, season, month, sortMonth, qualifier, file,
  };
}

/** "HAROLD L BOYLES JR" -> { lastName: "BOYLES", firstName: "JR HAROLD L" } */
function splitName(name) {
  const toks = squash(name).split(" ").filter(Boolean);
  if (toks.length === 0) return { lastName: "", firstName: "" };
  let suffix = "";
  if (toks.length > 1 && SUFFIXES.has(toks[toks.length - 1].replace(/\.$/, ""))) {
    suffix = toks.pop().replace(/\.$/, "");
  }
  const lastName = toks.pop();
  const firstName = [suffix, ...toks].filter(Boolean).join(" ");
  return { lastName, firstName };
}

// ------------------------------------------------------------------ input ---

const files = readdirSync(SOURCE_DIR).filter((f) => /absentee.*\.csv$/i.test(f));

if (!existsSync(OUT)) {
  throw new Error(`${OUT} does not exist - run convert-voters.mjs first.`);
}
console.log(`Reading voters.json ...`);
const data = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`  ${data.voters.length.toLocaleString()} voters on file`);
const COUNTY = (String(data.county ?? "").match(/^(.+?) County/) ?? [, "the"])[1];
const FIELDS = data.fields;
const BALLOT_COL = 14;
if (FIELDS[BALLOT_COL] !== "ballot") {
  if (FIELDS.length !== BALLOT_COL) {
    throw new Error(`Expected ${BALLOT_COL} fields before "ballot"; found ${FIELDS.join(", ")}`);
  }
  FIELDS.push("ballot");
}

// Start clean so the step is rerunnable: strip any earlier provisional merge -
// the election, every ballot cell, and the voters that merge added (their
// ballot cell carries a fourth element, 1). convert-voters.mjs rewrites the
// file from scratch anyway, but this script can also be run on its own after
// a fresh download, and a voter whose ballot was cancelled must not linger.
data.elections = data.elections.filter((e) => !e.provisional);
data.voters = data.voters.filter((v) => !(Array.isArray(v[BALLOT_COL]) && v[BALLOT_COL][3] === 1));
for (const v of data.voters) {
  // Clear the ballot cell but keep anything after it (the SoS roll's status).
  if (v.length > BALLOT_COL) v[BALLOT_COL] = 0;
  // The provisional bit, if one was set, was always the highest bit.
  v[9] &= (1 << data.elections.length) - 1;
}
// Cells after the ballot, when the roll came from the SoS file (convert-sos.mjs).
const STATUS_COL = FIELDS.indexOf("status");
const statusUnknown = STATUS_COL === -1 ? -1 : (() => {
  data.statuses ??= [];
  let i = data.statuses.indexOf("UNKNOWN");
  if (i === -1) { data.statuses.push("UNKNOWN"); i = data.statuses.length - 1; }
  return i;
})();
delete data.ballotCategories;
delete data.absentee;

if (files.length === 0) {
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`No absentee CSV in ${SOURCE_DIR} (name it like "<County>County_absentee 2026 general.csv"); nothing merged.`);
  process.exit(0);
}
if (files.length > 1) {
  throw new Error(`More than one absentee CSV in ${SOURCE_DIR}: ${files.join(", ")} - keep only the current election's.`);
}
const file = files[0];
const election = electionFromFilename(file);
if (!election) throw new Error(`"${file}" needs a YEAR and primary/general/special in its name.`);
if (data.elections.some((e) => e.label === election.label)) {
  throw new Error(
    `voters.json already has a finished "${election.label}" from the voter-history exports.\n` +
      `Delete ${file} - the official export supersedes the absentee file.`,
  );
}
if (data.elections.length >= 31) throw new Error("the election bitmask holds 31.");

console.log(`Reading ${election.label} absentee file: ${file}`);
const { format, rowCount, skipped, reissued, ballots } = readBallots(readFileSync(join(SOURCE_DIR, file), "utf8"));
console.log(`  format: ${format === "platform" ? "state platform CSV (lookup.boe.ohio.gov)" : "VoterView export"}`);

const categories = [];
const categoryIndex = (code) => {
  let i = categories.indexOf(code);
  if (i === -1) { categories.push(code); i = categories.length - 1; }
  return i;
};
for (const code of Object.keys(BALLOT_CATEGORIES)) categoryIndex(code);

const asOf = latestDate(ballots);

// ------------------------------------------------------- existing voters ---

const bit = 1 << data.elections.length;
const byId = new Map(data.voters.map((v) => [v[0], v]));
const { precincts, cities, zips, parties } = data;
const indexOf = (list, value) => {
  const i = list.indexOf(value);
  if (i !== -1) return i;
  list.push(value);
  return list.length - 1;
};

let matched = 0;
let matchedReturned = 0;
const unknown = [];
for (const [vid, b] of ballots) {
  const v = byId.get(vid);
  if (!v) { unknown.push([vid, b]); continue; }
  matched++;
  if (b.returned) { v[9] |= bit; matchedReturned++; }
  v[BALLOT_COL] = [categoryIndex(b.category), b.issued, b.returned, 0];
  if (b.issue) v[BALLOT_COL].push(b.issue);
}

// ------------------------------------------------------------ new voters ---

/**
 * Roll precinct codes by their bare form: "WAR 5D" -> ["WAR 5D.01", "WAR 5D.02"],
 * "HUB B" -> ["HUB B."]. The CSV writes single-letter precincts with a double
 * space ("HUB  B"), hence the squash on both sides.
 */
const rollByBare = new Map();
for (const p of precincts) {
  const bare = squash(p.replace(/\.\d*$/, ""));
  const list = rollByBare.get(bare) ?? [];
  list.push(p);
  rollByBare.set(bare, list);
}

/** street name (number stripped) + ZIP -> Set of roll precinct codes */
const precinctByStreet = new Map();
const streetKey = (street, zip) =>
  `${squash(street).replace(/^\d+\S*\s+/, "").replace(/#.*$/, "").trim()}|${zip}`;
for (const v of data.voters) {
  const k = streetKey(v[4], zips[v[6]]);
  let set = precinctByStreet.get(k);
  if (!set) { set = new Set(); precinctByStreet.set(k, set); }
  set.add(precincts[v[1]]);
}

const precinctStats = { exact: 0, byNeighbours: 0, bare: 0 };
function resolvePrecinct(code, street, zip) {
  const bare = squash(code);
  const candidates = rollByBare.get(bare);
  if (!candidates) { precinctStats.bare++; return bare; }
  if (candidates.length === 1) { precinctStats.exact++; return candidates[0]; }
  const neighbours = precinctByStreet.get(streetKey(street, zip));
  if (neighbours) {
    const hits = candidates.filter((c) => neighbours.has(c));
    if (hits.length === 1) { precinctStats.byNeighbours++; return hits[0]; }
  }
  precinctStats.bare++;
  return bare;
}

let addedWithStreet = 0;
let addedNoStreet = 0;
let addedOutOfState = 0;
let addedReturned = 0;
for (const [vid, b] of unknown) {
  const { lastName, firstName } = b.lastName ? { lastName: b.lastName, firstName: b.firstName } : splitName(b.name);
  // "WARREN, OH 44485" / "FAIRMONT, WV 26554" / "DUBLIN," (overseas)
  const m = b.csz.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})/);
  const city = m ? squash(m[1]) : squash(b.csz.replace(/,.*$/, ""));
  const state = m ? m[2] : "";
  const zip = m ? m[3] : "";
  const isEmail = /@/.test(b.mailTo);
  const inOhio = state === "OH";
  // Only an in-county mailing address can stand in for a residence.
  const street = !isEmail && inOhio && !/^P\.?O\.? BOX/i.test(b.mailTo) ? b.mailTo : "";
  if (street) addedWithStreet++;
  else if (!inOhio && !isEmail) addedOutOfState++;
  else addedNoStreet++;
  if (b.returned) addedReturned++;

  const cityOut = !state || inOhio ? city : `${city}, ${state}`;
  const row = [
    vid,
    indexOf(precincts, resolvePrecinct(b.precinct, street, zip)),
    lastName,
    firstName,
    street,
    indexOf(cities, cityOut),
    indexOf(zips, zip),
    "", // no registration date in this file
    indexOf(parties, b.party),
    b.returned ? bit : 0,
    null, null, 0, -1, // geocode fields, filled by geocode-voters.mjs
    // The trailing 1 marks a voter this file added, so a re-run can drop them.
    [categoryIndex(b.category), b.issued, b.returned, 1, ...(b.issue ? [b.issue] : [])],
  ];
  // Not on the roll file, so no registration status is known.
  if (STATUS_COL !== -1) row[STATUS_COL] = statusUnknown;
  data.voters.push(row);
}

// Rows without a ballot get an explicit 0 so every tuple has the same length.
for (const v of data.voters) if (v.length === BALLOT_COL) v[BALLOT_COL] = 0;
// A roll from convert-voters.mjs has no status cell; give every row the same shape.
if (STATUS_COL !== -1) for (const v of data.voters) if (v[STATUS_COL] === undefined) v[STATUS_COL] = statusUnknown;

// Keep the file's name order, which the app relies on for its default sort.
data.voters.sort((a, b) => a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]) || a[0] - b[0]);

// --------------------------------------------------------------- election ---

let returned = 0;
const byCategory = {};
const issues = {};
for (const b of ballots.values()) {
  if (b.returned) returned++;
  byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
  if (b.issue) issues[b.issue] = (issues[b.issue] ?? 0) + 1;
}

data.elections.push({
  id: election.id,
  label: election.label,
  year: election.year,
  season: election.season,
  month: election.month,
  sourceFile: file,
  /** Returned ballots - the only ones that are votes. */
  voters: returned,
  countyWide: true,
  scope: null,
  /** Early and absentee ballots for an election still in progress. */
  provisional: true,
  asOf,
  electionDate: election.season === "general" ? generalElectionDate(election.year) : null,
  issued: ballots.size,
  returned,
});
data.ballotCategories = categories;
data.ballotCategoryLabels = BALLOT_CATEGORIES;
data.absentee = {
  sourceFile: file,
  format,
  asOf,
  rows: rowCount,
  ballots: ballots.size,
  reissued,
  returned,
  byCategory,
  matchedExisting: matched,
  added: unknown.length,
  /** Returned ballots the Board has flagged (platform files only), by reason. */
  issues,
};
data.count = data.voters.length;

writeFileSync(OUT, JSON.stringify(data));

// ----------------------------------------------------------------- report ---

const pad = (n) => n.toLocaleString().padStart(7);
console.log(`  ${pad(rowCount)} ballot rows (${skipped} non-data rows skipped)`);
console.log(`  ${pad(ballots.size)} distinct voters (${reissued} ballots reissued)`);
console.log(`  ${pad(returned)} returned = votes; ${pad(ballots.size - returned).trim()} still out`);
const issueTotal = Object.values(issues).reduce((a, n) => a + n, 0);
if (issueTotal) {
  console.log(`  ${pad(issueTotal)} of the returned ballots are flagged by the Board:`);
  for (const [k, n] of Object.entries(issues).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${k}`);
}
console.log(`  latest date in the file: ${asOf}`);
console.log("\n  by category:");
for (const [code, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${code.padEnd(3)} ${pad(n)}  ${BALLOT_CATEGORIES[code] ?? "(unknown code)"}`);
}
console.log(`\n  ${pad(matched)} already on file (${matchedReturned.toLocaleString()} of them returned)`);
console.log(`  ${pad(unknown.length)} added from the absentee file (${addedReturned.toLocaleString()} returned):`);
console.log(`    ${pad(addedWithStreet)} with a ${COUNTY} street address`);
console.log(`    ${pad(addedOutOfState)} with an out-of-state or overseas mailing address (no street kept)`);
console.log(`    ${pad(addedNoStreet)} with an e-mail or PO box (no street kept)`);
console.log(
  `    precincts: ${precinctStats.exact} matched the roll, ${precinctStats.byNeighbours} split ` +
    `precincts settled by neighbours, ${precinctStats.bare} kept as the bare code`,
);
console.log(`\nWrote ${OUT} - ${data.voters.length.toLocaleString()} voters, ${data.elections.length} elections`);
console.log("Run `npm run geocode` next to place the new voters.");
