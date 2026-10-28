/**
 * Convert a TED "Election Vault" absentee list - the Blazor builder at
 * <board host>/TEDElectionLink/ElectionVault/files -> Absentee List -> Download
 * CSV - into a CSV in the state platform's column layout, which
 * scripts/lib/absentee.mjs already reads. Wood County's Board moved to this
 * builder in Oct 2026 (its old "Absentee Voter Files" page at
 * boe.woodcountyohio.gov/171 now answers 404). The download itself is done by
 * fetch-absentee-browser.mjs (recipe "tedvault"), because the builder is a
 * Blazor Server page: the CSV is produced over its SignalR connection, with no
 * URL to request. refresh-absentee.ps1 runs the two in turn when
 * react-app/absentee-source.json says
 *   { "fetcher": "browser", "recipe": "tedvault", "siteUrl": "https://votertools.woodcountyohio.gov",
 *     "convert": "fetch-absentee-tedvault.mjs" }
 *
 *   node scripts/fetch-absentee-tedvault.mjs --in=<absentee-list-yyyy-mm-dd.csv> "--out=../SourceData/WoodCounty_absentee 2026 general.csv"
 *
 * THE FILE (Wood, 28 Oct 2026): absentee-list-<yyyy-mm-dd>.csv, UTF-8 with a
 * BOM, every field quoted, one row per voter:
 *   VoterID ("000391652" - the county id the SoS roll calls COUNTY_ID, zero-
 *   padded; 7,166 of 7,166 matched the Wood roll), FirstName, MiddleName,
 *   LastName, Suffix, Age, Gender, PhoneNumber, ResAddr1/2, ResCityDesc,
 *   ResState, ResZip5, ResCountyDesc, BallotMailedAddr1/2, BallotMailedCity,
 *   BallotMailedZip5, BallotMailedState, BallotMailedCountry, MailRes* (the
 *   voter's own mailing address), RegistrationDate, PartyDesc (REPUBLICAN,
 *   DEMOCRAT, LIBERTARIAN, Unaffiliated), precinct (a number), PrecinctLabel
 *   ("BOWLING GREEN 3-D" - the SoS precinct name for 87 of Wood's 99),
 *   AbsPartySelected (primaries), AbsenteeRequestStatus (RETURNED, ISSUED,
 *   INCOMPLETE, PRINTED, REQUESTED), DateRequested, DateMailed, ValidityCode,
 *   DateReturned (dates yyyy-mm-dd; blank = none).
 *
 * MAIL BALLOTS ONLY. Every status the builder offers was downloaded on
 * 28 Oct 2026: 5,240 RETURNED and 1,926 ISSUED (all mailed), 111 INCOMPLETE
 * (no ballot sent), 1 PRINTED - no in-person early voters at all. So every row
 * is written as a MAIL application, and Wood's early in-person count stays at
 * zero until the Board publishes those voters somewhere (asked 28 Oct 2026).
 *
 * VALIDITY CODES. VAL = a valid returned ballot; a suffix says how it came
 * back: -DBOX the drop box, -PDEL delivered in person at the Board; no suffix =
 * by mail. Anything else on a returned ballot (IDDI, SIGMI, ADD, SIGDI... the
 * Board's problem codes - not published with the file; IDDI-DBOX is IDDI
 * from the drop box) is passed through as the ballot's status, so the app
 * shows "returned - IDDI" rather than either hiding the ballot or calling it
 * valid. Readings can be added to PROBLEM
 * below once the Board confirms them.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCsv } from "./lib/absentee.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const OUT = args.out ? resolve(args.out) : null;
if (!OUT || !args.in) {
  console.error("usage: fetch-absentee-tedvault.mjs --in=<Election Vault absentee-list csv> --out=<platform-layout csv path>");
  process.exit(2);
}

const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

const PARTY = { REPUBLICAN: "REP", DEMOCRAT: "DEM", LIBERTARIAN: "LIB", GREEN: "GRE", CONSTITUTION: "CON", SOCIALIST: "SOC" };
/** How a valid ballot came back, from the suffix on VAL. */
const RETURN_METHOD = { "": "MAILED", DBOX: "DROP BOX", PDEL: "O T C/ PERSONAL DELIVERY" };
/** Readable problem statuses, once the Board confirms what its codes mean. Unlisted codes pass through. */
const PROBLEM = {};

/** "2026-10-14" -> "10/14/2026" (lib/absentee.mjs reads m/d/y); "" when blank. */
function mdy(s) {
  const m = squash(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
}

console.log(`Read ${args.in}`);
const text = readFileSync(resolve(args.in), "utf8").replace(/^﻿/, "");
const rows = parseCsv(text);
if (rows.length < 2) throw new Error("no data rows in the absentee list");
const header = rows[0].map((h) => squash(h).toUpperCase());
const col = {};
header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
for (const need of ["VOTERID", "FIRSTNAME", "LASTNAME", "PARTYDESC", "PRECINCTLABEL", "ABSENTEEREQUESTSTATUS",
  "DATEREQUESTED", "DATEMAILED", "VALIDITYCODE", "DATERETURNED", "RESADDR1", "BALLOTMAILEDADDR1"]) {
  if (!(need in col)) throw new Error(`no '${need}' column in: ${header.join(" | ")}`);
}
const get = (r, name) => (name in col ? squash(r[col[name]]) : "");

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
let returned = 0, problems = 0, skipped = 0, dupes = 0, notSent = 0;
const byStatus = new Map(), byMethod = new Map(), byProblem = new Map();
let latest = "";
const today = new Date().toISOString().slice(0, 10);

// One row per voter, as the platform does; should the list ever carry a
// voter twice, keep the returned row, else the later mailing.
const byVoter = new Map();
for (const r of rows.slice(1)) {
  const id = get(r, "VOTERID");
  if (!/^\d+$/.test(id)) { skipped++; continue; }
  const key = Number(id);
  const prev = byVoter.get(key);
  if (!prev) { byVoter.set(key, r); continue; }
  dupes++;
  const rank = (x) => (get(x, "DATERETURNED") ? "2" : "1") + get(x, "DATEMAILED");
  if (rank(r) > rank(prev)) byVoter.set(key, r);
}

for (const [id, r] of byVoter) {
  const status = get(r, "ABSENTEEREQUESTSTATUS").toUpperCase();
  byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  const sent = mdy(get(r, "DATEMAILED"));
  const ret = mdy(get(r, "DATERETURNED"));
  if (!sent && !ret) notSent++;
  const code = get(r, "VALIDITYCODE").toUpperCase();
  const [base, suffix = ""] = code.split("-");
  let method = "NOT RECEIVED", balStat = "";
  if (ret) {
    returned++;
    method = RETURN_METHOD[suffix] ?? "MAILED";
    if (base === "VAL") balStat = "VALID";
    else if (base) { balStat = PROBLEM[base] ?? base; problems++; byProblem.set(base, (byProblem.get(base) ?? 0) + 1); }
    else balStat = "VALID"; // returned with no code yet: counted, not flagged
    byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
  }
  for (const d of [get(r, "DATEMAILED"), get(r, "DATERETURNED")]) if (d && d <= today && d > latest) latest = d;

  // Where the ballot went: the BallotMailed* columns, else the residence.
  let street = get(r, "BALLOTMAILEDADDR1"), unit = get(r, "BALLOTMAILEDADDR2"), city = get(r, "BALLOTMAILEDCITY"),
    state = get(r, "BALLOTMAILEDSTATE"), zip = get(r, "BALLOTMAILEDZIP5");
  const country = get(r, "BALLOTMAILEDCOUNTRY");
  if (!street) {
    street = get(r, "RESADDR1"); unit = get(r, "RESADDR2"); city = get(r, "RESCITYDESC");
    state = get(r, "RESSTATE"); zip = get(r, "RESZIP5");
  }
  const party = get(r, "PARTYDESC").toUpperCase();
  out.push([
    get(r, "LASTNAME").toUpperCase(), get(r, "FIRSTNAME").toUpperCase(), get(r, "MIDDLENAME").toUpperCase(), get(r, "SUFFIX").toUpperCase(),
    PARTY[party] ?? "",
    String(id),
    street.toUpperCase(), unit.toUpperCase(), city.toUpperCase(), state.toUpperCase().slice(0, 2), zip.slice(0, 5),
    /^(US|USA|UNITED STATES)?$/i.test(country) ? "" : country.toUpperCase(),
    sent, ret, method, "MAIL",
    get(r, "PRECINCTLABEL").toUpperCase(),
    mdy(get(r, "DATEREQUESTED")),
    balStat,
    `TEDVAULT ${status}`,
  ].map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
const list = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(", ");
console.log(`Wrote ${OUT}`);
console.log(`  ${(rows.length - 1).toLocaleString()} rows -> ${(out.length - 1).toLocaleString()} voters${dupes ? ` (${dupes} duplicate rows collapsed)` : ""}${skipped ? `, ${skipped} rows skipped` : ""}; latest date ${latest}`);
console.log(`  by status: ${list(byStatus)}${notSent ? ` (${notSent.toLocaleString()} with no ballot sent)` : ""}`);
console.log(`  ${returned.toLocaleString()} returned: ${list(byMethod)}${problems ? `; ${problems} with a problem code (${list(byProblem)})` : ""}`);
console.log(`::notice title=Absentee data::Election Vault absentee list (mail ballots only), ${out.length - 1} voters, data through ${latest}`);
