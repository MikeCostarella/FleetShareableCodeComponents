/**
 * Write data/stats.json into the built site: a few-kilobyte summary of
 * voters.json for anything that wants this county's numbers without the
 * whole roll - first of all the fleet's CurrentElectionStatistics app, which
 * collects every county's stats.json from GitHub Pages twice a day and keeps
 * the series.
 *
 *   node --max-old-space-size=4096 scripts/write-stats.mjs        (after vite build; part of `npm run build`)
 *   node scripts/write-stats.mjs --out=<path>                       (anywhere else)
 *
 * Reads public/data/voters.json and writes dist/data/stats.json by default.
 * The file is derived, not committed: it exists only in the deployed site,
 * at https://mikecostarella.github.io/<County>CountyVoters/data/stats.json,
 * and is rebuilt by every deploy and every absentee merge.
 *
 * WHAT IS IN IT
 *   county, fips, generatedAt, runDate (when voters.json was last written)
 *   roll:       registered, active, confirmation, onFile (incl. voters known
 *               only from the absentee file), byParty / activeByParty, source
 *               file + its as-of date
 *   elections:  every election kept, with its turnout, flagged provisional
 *               for the one in progress
 *   baseline:   the last finished general of the same cycle (even / odd
 *               year) - what the Voters app paces the early vote against
 *   early:      the election in progress - issued, returned, out, flagged,
 *               in person / by mail, by category, by party (issued and
 *               returned), and byDay: returned per day with the running
 *               total and per-party counts. null when no absentee file is
 *               merged yet (a county shipped history-only).
 *   geocode:    placed / unplaced
 * Party codes are the roll's: D, R, L, G, ... and "--" for unaffiliated.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const VOTERS = resolve(args.in ?? join(app, "public", "data", "voters.json"));
const OUT = resolve(args.out ?? join(app, "dist", "data", "stats.json"));

if (!existsSync(VOTERS)) {
  console.log(`write-stats: no ${VOTERS} - nothing to summarise.`);
  process.exit(0);
}

const fips = (readFileSync(join(app, "src", "config", "county.ts"), "utf8").match(/COUNTY_FIPS\s*=\s*"(\d{5})"/) || [])[1] ?? null;

const data = JSON.parse(readFileSync(VOTERS, "utf8"));
const F = Object.fromEntries(data.fields.map((f, i) => [f, i]));
const parties = data.parties ?? [];
const statuses = data.statuses ?? [];
const categories = data.ballotCategories ?? [];
const voters = data.voters;

// ------------------------------------------------------------------ roll ---

const statusCount = {};
const rollByParty = {};
const activeByParty = {};
for (const v of voters) {
  const s = statuses[v[F.status]] ?? "UNKNOWN";
  statusCount[s] = (statusCount[s] ?? 0) + 1;
  const party = parties[v[F.party]] ?? "--";
  rollByParty[party] = (rollByParty[party] ?? 0) + 1;
  if (s === "ACTIVE") activeByParty[party] = (activeByParty[party] ?? 0) + 1;
}

// ------------------------------------------------------------- elections ---

const elections = data.elections.map((e, i) => ({
  id: e.id, label: e.label, date: e.date, year: e.year, season: e.season,
  voters: e.voters, countyWide: e.countyWide !== false, provisional: e.provisional === true, bit: i,
}));
const live = elections.find((e) => e.provisional) ?? null;
const finished = elections.filter((e) => !e.provisional);
const generals = finished.filter((e) => e.season === "general");
const sameCycle = live ? generals.filter((e) => e.year % 2 === live.year % 2) : generals;
const baseline = (sameCycle.length ? sameCycle : generals).at(-1) ?? null;

// ----------------------------------------------------------------- early ---

const IN_PERSON = new Set(["EV", "CB"]);
let early = null;
if (live && data.absentee) {
  const byDay = new Map();
  const byParty = {};
  const byCategory = {};
  const returnedByCategory = {};
  let issued = 0, returned = 0, flagged = 0, inPerson = 0, fromFile = 0, undated = 0;
  // A return dated after the file itself (Lake, Oct 2026: "4206-11-02") is a
  // Board typo: the ballot counts as returned, but not on any day.
  const asOf = data.absentee.asOf ?? new Date().toISOString().slice(0, 10);
  for (const v of voters) {
    const b = v[F.ballot];
    if (!Array.isArray(b)) continue;
    issued++;
    const cat = categories[b[0]] ?? "?";
    const party = parties[v[F.party]] ?? "--";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    const p = (byParty[party] ??= { issued: 0, returned: 0 });
    p.issued++;
    if (b[3]) fromFile++;
    const ret = b[2];
    if (!ret) continue;
    returned++;
    p.returned++;
    returnedByCategory[cat] = (returnedByCategory[cat] ?? 0) + 1;
    if (b[4]) flagged++;
    const person = IN_PERSON.has(cat);
    if (person) inPerson++;
    if (ret > asOf) { undated++; continue; }
    let d = byDay.get(ret);
    if (!d) byDay.set(ret, (d = { date: ret, returned: 0, inPerson: 0, mail: 0, byParty: {} }));
    d.returned++;
    if (person) d.inPerson++; else d.mail++;
    d.byParty[party] = (d.byParty[party] ?? 0) + 1;
  }
  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let run = 0;
  for (const d of days) { run += d.returned; d.cumulative = run; }
  early = {
    election: { id: live.id, label: live.label, date: live.date },
    asOf: data.absentee.asOf ?? null,
    sourceFormat: data.absentee.format ?? null,
    issued, returned, out: issued - returned, flagged, inPerson, mail: returned - inPerson,
    addedFromFile: fromFile,
    /** Returned ballots whose return date is after the file's as-of date (a Board typo) - in the totals, not in byDay. */
    undated,
    byCategory, returnedByCategory, byParty,
    byDay: days,
  };
}

// ---------------------------------------------------------------- write ---

const registered = data.source?.registered ?? voters.length;
const stats = {
  county: data.county,
  fips,
  generatedAt: new Date().toISOString(),
  runDate: data.runDate ?? null,
  roll: {
    registered,
    active: statusCount.ACTIVE ?? data.source?.active ?? null,
    confirmation: statusCount.CONFIRMATION ?? null,
    onFile: voters.length,
    // Party affiliation as the SoS file carries it: the last primary ballot
    // pulled (Ohio has no party registration); "--" is unaffiliated.
    byParty: rollByParty,
    activeByParty,
    source: { kind: data.source?.kind ?? null, file: data.source?.file ?? null, asOf: data.source?.asOf ?? null },
  },
  elections: elections.map(({ bit, ...e }) => e),
  baseline: baseline ? { id: baseline.id, label: baseline.label, voters: baseline.voters } : null,
  early,
  geocode: data.geocode
    ? { placed: data.geocode.placed, unplaced: data.geocode.unplaced, placedPct: Math.round((data.geocode.placed / voters.length) * 1000) / 10 }
    : null,
  precincts: data.precincts?.length ?? null,
  jurisdictions: data.jurisdictions?.length ?? null,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(stats), "utf8");
const kb = (Buffer.byteLength(JSON.stringify(stats)) / 1024).toFixed(1);
console.log(`write-stats: ${OUT} (${kb} KB) - ${registered.toLocaleString()} registered` +
  (early ? `, early vote ${early.returned.toLocaleString()} of ${early.issued.toLocaleString()} returned through ${early.asOf}` : ", no early vote yet"));
