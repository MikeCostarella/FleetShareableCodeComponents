/**
 * Build react-app/public/data/voters.json from the Board of Elections exports
 * in SourceData/.
 *
 *   cd react-app && npm run convert     # convert, then geocode
 *   node scripts/convert-voters.mjs     # convert only
 *
 * ONE FILE PER ELECTION, ONE RECORD PER VOTER
 *
 * Each .xls in SourceData/ is one election's voter-history export - the list of
 * people who cast a ballot in it. A voter who turned out three times appears in
 * three files, so the merged dataset keys on the BOE voter ID and records which
 * elections each person voted in as a bitmask.
 *
 * The election's name comes from the filename: "..._voted 2025 general.xls"
 * becomes "2025 General". Drop a new export into SourceData/, re-run, done.
 *
 * NOT EVERY ELECTION IS COUNTY-WIDE
 *
 * "..._voted feb 2026 cortland special.xls" is a Cortland-only ballot issue:
 * 1,229 voters, 1,222 of them in CORT precincts. Two consequences.
 *
 * The name needs a month. Ohio primaries are in May and generals in November,
 * so season alone orders those fine - but a special can fall anywhere, and this
 * one is in February, before the May primary it would otherwise sort after.
 *
 * More importantly, the app must not tell a Warren voter they "did not vote" in
 * an election they were never on the ballot for. Each election therefore
 * carries the set of precincts that actually appear in its export; an election
 * covering most of the county is marked county-wide and stores no list. That is
 * derived rather than declared, so it cannot fall out of step with the data -
 * and it is printed at the end of every run so a wrong derivation is visible.
 *
 * Scope is decided on turnout, not on presence. A precinct is in scope only if
 * its turnout reaches a fraction of that election's median precinct turnout -
 * see SCOPE_MIN_SHARE_OF_MEDIAN. Presence alone was too weak a test: the
 * exports carry current roll attributes, so a single voter who has moved since
 * pulls their whole new precinct into an old election's scope. Seven such
 * voters made the Cortland special look 60% wider than it was, and 67 of them
 * spread across the county made the partial May 2023 primary clear an 80%
 * coverage bar it should never have reached - which would have told 8,597
 * voters in 26 precincts that they skipped an election that was never on their
 * ballot.
 *
 * Both the scope and the precincts rejected as strays are printed after every
 * run, so a wrong call is visible rather than buried in the data.
 *
 * WHICH COPY OF A VOTER'S DETAILS WINS
 *
 * The export carries the voter's CURRENT roll attributes - name, address,
 * precinct, party, registration date - not what they were on election day. So
 * the same voter's rows in two files agree, and when the 2025 general and 2026
 * primary were first merged all 21,008 shared voters matched on every field.
 *
 * That is a property of these two exports, not a guarantee. The newest election
 * wins, because it is the freshest snapshot of the roll, and any disagreement
 * is counted and printed rather than silently resolved - an export that starts
 * contradicting its siblings is something you want to hear about.
 *
 * WHY THE PARSING ISN'T A PLAIN sheet_to_json
 *
 * The export is a formatted report, not a table: the real column header sits on
 * row 7, and the body is broken up by alphabet dividers ("A", "B", ...) and
 * "Total : 851" subtotal lines. Anything whose first cell is not a numeric
 * voter ID is skipped.
 *
 * Output is column-indexed - precinct, city, ZIP and party become indexes into
 * lookup tables - which keeps 42k records near 3 MB rather than 7 MB.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SOURCE_DIR = join(ROOT, "SourceData");
const OUT = join(ROOT, "react-app", "public", "data", "voters.json");

// Column positions in the export (0-based), taken from the header on row 7.
const COL = { id: 0, precinct: 2, name: 5, street: 6, csz: 11, reg: 13, pty: 14 };

/**
 * Typical month for each season, used to order elections within a year when the
 * filename does not name one. Ohio primaries run in May and generals in
 * November; a special can be any month, so it sits between them only as a last
 * resort - name the month in the file and it sorts properly.
 */
const SEASON_MONTH = { primary: 5, special: 6, general: 11 };

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * An election covering at least this share of the county's precincts is treated
 * as county-wide and stores no precinct list. Below it, the election is scoped
 * and every voter outside those precincts counts as ineligible rather than as a
 * no-show.
 */
const COUNTY_WIDE_SHARE = 0.8;

/**
 * A precinct is in an election's scope only if its turnout reaches this share
 * of that election's MEDIAN precinct turnout.
 *
 * Mere presence in the export is not enough, because the exports carry a
 * voter's CURRENT precinct, not the one they voted in. Someone who has moved
 * since drags their new precinct into the old election's scope, and one such
 * voter is enough to make a precinct look covered.
 *
 * The two populations are far apart, so the cut is not delicate. In the May
 * 2023 primary - held only in part of the county - the precincts where it was
 * genuinely on the ballot run 5-40% turnout (median 14.5%), while the movers
 * show up as one to seven voters in a precinct of several hundred: 0.1-1.0%.
 * A genuinely county-wide low-turnout election has no such tail at all; the
 * May 2025 primary has the same 14.6% median and nothing whatsoever between
 * zero and 5%. That gap - not an absolute number - is the signal, so the floor
 * is expressed relative to each election's own median.
 */
const SCOPE_MIN_SHARE_OF_MEDIAN = 0.2;

/**
 * "TrumbullCounty_voted feb 2026 cortland special.xls" ->
 *   { id: "2026-02-special-cortland", label: "Feb 2026 Cortland Special", ... }
 *
 * The year, season and optional month are found anywhere in the name rather
 * than in a fixed order, because they are not written in one. Whatever words
 * are left over - after dropping the county prefix, "voted", and the parts
 * already consumed - become the qualifier, which is how "cortland" reaches the
 * label without being declared anywhere.
 *
 * Returns null when there is no year or no season, so a stray spreadsheet is
 * reported and skipped instead of becoming a phantom election.
 */
function electionFromFilename(file) {
  const base = file.replace(/\.xlsx?$/i, "");
  const words = base.split(/[\s_\-]+/).filter(Boolean);

  let year = null;
  let season = null;
  let month = null;
  const rest = [];

  for (const w of words) {
    const lower = w.toLowerCase();
    if (year === null && /^(19|20)\d{2}$/.test(lower)) { year = Number(lower); continue; }
    if (season === null && /^(primary|general|special)$/.test(lower)) { season = lower; continue; }
    if (month === null && MONTHS[lower] !== undefined) { month = MONTHS[lower]; continue; }
    // Drop the fleet's own filename furniture rather than labelling with it.
    if (lower === "voted" || /county$/.test(lower)) continue;
    rest.push(w);
  }
  if (year === null || season === null) return null;

  const title = season[0].toUpperCase() + season.slice(1);
  const qualifier = rest
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  // "Feb 2026 Cortland Special" / "2025 General"
  const label = [
    month ? MONTH_NAMES[month] : "",
    String(year),
    qualifier,
    title,
  ]
    .filter(Boolean)
    .join(" ");

  const sortMonth = month ?? SEASON_MONTH[season];
  return {
    id: [year, String(sortMonth).padStart(2, "0"), season, qualifier.toLowerCase().replace(/\s+/g, "-")]
      .filter(Boolean)
      .join("-"),
    label,
    year,
    season,
    month,
    sortMonth,
    qualifier,
    file,
  };
}

const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Excel serial date or Date -> "YYYY-MM-DD" ("" when absent/unparseable). */
function isoDate(v) {
  if (v == null || v === "") return "";
  const pad = (n) => String(n).padStart(2, "0");
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : "";
  }
  const s = squash(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : s;
}

/** Parse one export into { voterId -> attributes }. */
function readExport(path) {
  const wb = XLSX.read(readFileSync(path), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  const voters = new Map();
  const precinctsSeen = new Set();
  let skipped = 0;
  for (const row of rows) {
    const id = squash(row?.[COL.id]);
    const name = squash(row?.[COL.name]);
    if (!/^\d+$/.test(id) || !name) {
      skipped++;
      continue;
    }
    const comma = name.indexOf(",");
    const lastName = squash(comma === -1 ? name : name.slice(0, comma));
    const firstName = squash(comma === -1 ? "" : name.slice(comma + 1));

    const csz = squash(row[COL.csz]);
    const m = csz.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})/);

    precinctsSeen.add(squash(row[COL.precinct]));
    voters.set(Number(id), {
      lastName,
      firstName,
      precinct: squash(row[COL.precinct]),
      street: squash(row[COL.street]),
      city: m ? squash(m[1]) : csz,
      zip: m ? m[3] : "",
      registered: isoDate(row[COL.reg]),
      party: squash(row[COL.pty]) || "--",
    });
  }
  return { voters, skipped, precinctsSeen };
}

// ------------------------------------------------------------- the elections ---

const files = readdirSync(SOURCE_DIR).filter((f) => /\.xlsx?$/i.test(f));
if (files.length === 0) {
  throw new Error(`No .xls/.xlsx export found in ${SOURCE_DIR}`);
}

const elections = [];
for (const file of files) {
  const e = electionFromFilename(file);
  if (!e) {
    console.warn(`  ! skipping "${file}" - no YEAR + primary/general/special in the name`);
    continue;
  }
  elections.push(e);
}
if (elections.length === 0) {
  throw new Error(
    `No election could be identified from the filenames in ${SOURCE_DIR}.\n` +
      `Name each export like "TrumbullCounty_voted 2025 general.xls".`,
  );
}
if (elections.length > 31) {
  // The per-voter membership is a bitmask in a JS number used with |, which is
  // a 32-bit signed operation. Well past any realistic number of exports.
  throw new Error(`${elections.length} elections found; the bitmask holds 31.`);
}

// Oldest first, so bit 0 is the earliest election and the app can show them in
// chronological order without re-sorting.
elections.sort((a, b) => a.year - b.year || a.sortMonth - b.sortMonth);

// ------------------------------------------------------------------- merging ---

/** voterId -> { attributes, mask } */
const merged = new Map();
const conflicts = new Map(); // field -> count

for (let bit = 0; bit < elections.length; bit++) {
  const e = elections[bit];
  const path = join(SOURCE_DIR, e.file);
  console.log(`Reading ${e.label.padEnd(14)} ${e.file}`);
  const { voters, skipped, precinctsSeen } = readExport(path);
  e.voters = voters.size;
  e.skippedRows = skipped;
  e.precinctsSeen = precinctsSeen;

  for (const [id, attrs] of voters) {
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { attrs, mask: 1 << bit });
      continue;
    }
    existing.mask |= 1 << bit;
    // Elections are processed oldest-first, so a later file is newer: let it
    // win, but count what it overwrote.
    for (const k of Object.keys(attrs)) {
      if (existing.attrs[k] !== attrs[k]) {
        conflicts.set(k, (conflicts.get(k) ?? 0) + 1);
      }
    }
    existing.attrs = attrs;
  }
  console.log(
    `  ${voters.size.toLocaleString()} voters (${skipped.toLocaleString()} non-data rows skipped)`,
  );
}

// -------------------------------------------------------------------- scope ---

/**
 * Every precinct the county has, across all elections - the denominator for
 * deciding whether an election reached the whole county.
 */
const allPrecincts = new Set();
for (const e of elections) for (const p of e.precinctsSeen) allPrecincts.add(p);

/**
 * Turnout per precinct per election, over the MERGED roll: how many of the
 * voters who now live in a precinct turned out for each election, out of how
 * many live there. Both sides use the same current-precinct attribute, so the
 * rate is a like-for-like comparison.
 */
const precinctSize = new Map();
const precinctHits = elections.map(() => new Map());
for (const { attrs, mask } of merged.values()) {
  const p = attrs.precinct;
  precinctSize.set(p, (precinctSize.get(p) ?? 0) + 1);
  for (let i = 0; i < elections.length; i++) {
    if (mask & (1 << i)) {
      precinctHits[i].set(p, (precinctHits[i].get(p) ?? 0) + 1);
    }
  }
}

elections.forEach((e, i) => {
  // Precincts with any turnout at all, weakest first.
  const seen = [];
  for (const [p, size] of precinctSize) {
    const hit = precinctHits[i].get(p) ?? 0;
    if (hit > 0) seen.push({ precinct: p, rate: hit / size, voters: hit });
  }
  seen.sort((a, b) => a.rate - b.rate);

  const median = seen.length ? seen[Math.floor(seen.length / 2)].rate : 0;
  const floor = median * SCOPE_MIN_SHARE_OF_MEDIAN;
  const held = seen.filter((s) => s.rate >= floor);

  e.medianTurnout = median;
  e.turnoutFloor = floor;
  e.strays = seen.filter((s) => s.rate < floor);
  e.scopeSet = new Set(held.map((s) => s.precinct));

  const share = allPrecincts.size ? e.scopeSet.size / allPrecincts.size : 1;
  e.precinctShare = share;
  e.countyWide = share >= COUNTY_WIDE_SHARE;
  // A county-wide election stores no list: every voter is eligible, and 188
  // precinct strings per election is payload nobody reads.
  e.scope = e.countyWide ? null : [...e.scopeSet].sort();
});

// ------------------------------------------------------------------- output ---

const precincts = [];
const cities = [];
const zips = [];
const parties = [];
const indexOf = (list, value) => {
  const i = list.indexOf(value);
  if (i !== -1) return i;
  list.push(value);
  return list.length - 1;
};

const voters = [];
for (const [id, { attrs, mask }] of merged) {
  voters.push([
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
  ]);
}

// Sort by name so the default table order needs no work at runtime.
voters.sort(
  (a, b) => a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]) || a[0] - b[0],
);

const data = {
  county: "Trumbull County, Ohio",
  runDate: new Date().toISOString().slice(0, 10),
  count: voters.length,
  /**
   * Chronological. A voter's `elections` value has bit N set when they voted in
   * elections[N].
   */
  elections: elections.map((e) => ({
    id: e.id,
    label: e.label,
    year: e.year,
    season: e.season,
    month: e.month,
    sourceFile: e.file,
    voters: e.voters,
    /** False for a ballot that only part of the county could vote on. */
    countyWide: e.countyWide,
    /** Precincts eligible to vote in it; null when county-wide. */
    scope: e.scope,
  })),
  fields: [
    "id", "precinct", "lastName", "firstName", "street", "city", "zip",
    "registered", "party", "elections", "lat", "lon", "geo", "jurisdiction",
  ],
  precincts,
  cities,
  zips,
  parties,
  voters,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));

// ------------------------------------------------------------------ report ---

console.log(`\nMerged ${voters.length.toLocaleString()} distinct voters across ${elections.length} elections`);
for (let bit = 0; bit < elections.length; bit++) {
  const e = elections[bit];
  const n = voters.filter((v) => v[9] & (1 << bit)).length;
  console.log(`  ${e.label.padEnd(14)} ${n.toLocaleString().padStart(7)}`);
}
const scoped = elections.filter((e) => !e.countyWide);
if (scoped.length) {
  console.log("\n  Not county-wide:");
  for (const e of scoped) {
    const top = [...e.scopeSet]
      .map((p) => p.split(/\s+/)[0])
      .reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
    const lead = [...top].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, n]) => `${k}\u00d7${n}`).join(", ");
    console.log(
      `    ${e.label}: ${e.scopeSet.size} of ${allPrecincts.size} precincts ` +
        `(${(e.precinctShare * 100).toFixed(0)}%) - ${lead}`,
    );
  }
}

// Precincts that appear in an export but well below its median turnout: voters
// who have moved since, carrying their new precinct into an old election. Shown
// so that a mis-set floor is visible rather than silent.
const withStrays = elections.filter((e) => e.strays.length);
if (withStrays.length) {
  console.log("\n  Left out of scope - turnout far below the election's median:");
  for (const e of withStrays) {
    const n = e.strays.reduce((a, s) => a + s.voters, 0);
    const worst = e.strays[e.strays.length - 1];
    console.log(
      `    ${e.label.padEnd(26)} ${String(e.strays.length).padStart(3)} precincts, ` +
        `${String(n).padStart(4)} voters  ` +
        `(median ${(e.medianTurnout * 100).toFixed(1)}%, floor ` +
        `${(e.turnoutFloor * 100).toFixed(1)}%, highest dropped ` +
        `${worst.precinct} at ${(worst.rate * 100).toFixed(2)}%)`,
    );
  }
}

if (elections.length > 1) {
  // Eligibility-aware: "voted in all" means every election this voter could
  // actually vote in, so a county-wide regular who was never on a Cortland
  // ballot still counts as never missing one.
  const eligibleMaskFor = (precinct) => {
    let mask = 0;
    elections.forEach((e, i) => {
      if (e.countyWide || e.scopeSet.has(precinct)) mask |= 1 << i;
    });
    return mask;
  };
  const byPrecinct = new Map();
  let every = 0;
  let one = 0;
  for (const v of voters) {
    const precinct = precincts[v[1]];
    let elig = byPrecinct.get(precinct);
    if (elig === undefined) {
      elig = eligibleMaskFor(precinct);
      byPrecinct.set(precinct, elig);
    }
    if (elig !== 0 && (v[9] & elig) === elig) every++;
    const m = v[9];
    if (m !== 0 && (m & (m - 1)) === 0) one++;
  }
  console.log(`\n  voted in every eligible election ${every.toLocaleString().padStart(7)}`);
  console.log(`  voted in exactly one             ${one.toLocaleString().padStart(7)}`);
}
if (conflicts.size) {
  console.log("\n  ! the newer export disagreed with an older one:");
  for (const [field, n] of conflicts) {
    console.log(`      ${field}: ${n.toLocaleString()} voters (newest value kept)`);
  }
} else {
  console.log("\n  every shared voter's details agreed across exports.");
}
console.log(`\nWrote ${OUT}`);
console.log("Run `npm run geocode` next to put the coordinates back.");
