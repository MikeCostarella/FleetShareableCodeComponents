/**
 * Convert the Cuyahoga County Board of Elections' vote-by-mail export into a
 * CSV in the state platform's column layout, which scripts/lib/absentee.mjs
 * already reads. The download itself is done by fetch-absentee-browser.mjs
 * (recipe "cuyahoga"), because the Board's page is a JavaScript form with a
 * full-page POST behind it; refresh-absentee.ps1 runs the two in turn when
 * react-app/absentee-source.json says
 *   { "fetcher": "browser", "recipe": "cuyahoga", "siteUrl": "https://boe.cuyahogacounty.gov",
 *     "convert": "fetch-absentee-cuyahoga.mjs" }
 *
 *   node scripts/fetch-absentee-cuyahoga.mjs --in=<Export-yyyymmdd-hhmmss.csv> "--out=../SourceData/CuyahogaCounty_absentee 2026 general.csv"
 *
 * THE BOARD'S PAGE (recorded from the browser, 26 Oct 2026)
 * /candidates/Get-Vote-by-Mail-Labels-and-Lists is a form that POSTs to
 * .../GetAbsenteeData: election, Date Issued From / To (both required),
 * party, district type -> district -> precinct, and a radio for 5160 labels
 * or CSV. County Wide + CSV + the whole date range gives every ballot of the
 * election, returned or not. The reCAPTCHA badge on the page belongs to the
 * "Was this page helpful?" widget, not to the download.
 *
 * THE FILE: Export-<yyyymmdd>-<hhmmss>.csv, one row per ballot:
 *   Voter ID (the county id the SoS roll uses - 148,056 of 148,057 matched on
 *   26 Oct 2026), Voter Name ("Abigail M. Heredos", "George O. Fillinger II."),
 *   Precinct ("BAYVILLAGE-01-A" - the Board drops the spaces the SoS keeps),
 *   Party (NON DEM REP LIB), Address1, Address2 ("Bay Village Oh 44140"),
 *   CareOf, Category (the Board's codes, below), Challenged (a reason, or
 *   blank), DateIssued, DateReturned ("9/11/2026 12:00:00 PM"; blank = still
 *   out), MailStreet, MailCity, MailState, MailZip, MailCountry.
 *
 * CATEGORY CODES (the Board's vbmcodes.pdf) -> the platform application types
 * lib/absentee.mjs maps onto the fleet's ballot categories:
 *   B  Vote-by-Mail voter                              -> MAIL
 *   A  Ballot mailed to an address other than registered -> MAIL
 *   I  Early in-person voter                           -> IN OFFICE
 *   TR Voter picked up a ballot from early in-person   -> HAND CARRY
 *   N  Vote-by-Mail voter confined to a nursing home   -> NURSING HOME
 *   G  Nursing home with in-person assistance          -> NURSING HOME
 *   H  Hospitalized after the request period closed    -> HOSPITAL
 *   J  Voter confined to a jail                        -> JAIL
 *   M  Military (UOCAVA)                               -> MILITARY
 *   ME Military, electronic (UOCAVA)                   -> UOCAVA EMAIL
 *   O  Overseas (UOCAVA)                               -> CIVILIAN OVERSEAS
 *   OE Overseas, electronic (UOCAVA)                   -> UOCAVA EMAIL
 *   R  Remote ballot marking voter                     -> ACCESSIBLE BALLOT
 *   17 YR  17-year-old voter                           -> MAIL
 * A returned ballot with a Challenged reason is RETURNED but flagged, as on
 * the platform (the reason becomes AVBALSTAT); a returned ballot without one
 * is VALID.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const OUT = args.out ? resolve(args.out) : null;
if (!OUT || !args.in) {
  console.error("usage: fetch-absentee-cuyahoga.mjs --in=<Board export csv> --out=<platform-layout csv path>");
  process.exit(2);
}

const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

/** RFC-4180: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const CATEGORY = {
  "B": "MAIL", "A": "MAIL", "17 YR": "MAIL", "17YR": "MAIL",
  "J": "JAIL", "H": "HOSPITAL",
  "I": "IN OFFICE",
  "TR": "HAND CARRY",
  "N": "NURSING HOME", "G": "NURSING HOME",
  "M": "MILITARY", "ME": "UOCAVA EMAIL",
  "O": "CIVILIAN OVERSEAS", "OE": "UOCAVA EMAIL",
  "R": "ACCESSIBLE BALLOT",
};
const PARTY = { NON: "", DEM: "DEM", REP: "REP", LIB: "LIB", GRE: "GRE" };
const SUFFIX = /^(JR|SR|II|III|IV|V)\.?$/i;

/** "9/11/2026 12:00:00 PM" -> "9/11/2026" (lib/absentee.mjs reads m/d/y); "" when blank. */
function mdy(s) {
  const m = squash(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${Number(m[1])}/${Number(m[2])}/${m[3]}` : "";
}

/** "Abigail M. Heredos" / "George O. Fillinger II." -> [last, first, middle, suffix], upper-cased like the roll. */
function splitName(name) {
  const parts = squash(name).replace(/\./g, "").toUpperCase().split(" ").filter(Boolean);
  let suffix = "";
  if (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();
  const last = parts.pop() ?? "";
  const first = parts.shift() ?? "";
  return [last, first, parts.join(" "), suffix];
}

/** "Bay Village Oh 44140" -> [city, state, zip]. */
function splitCsz(s) {
  const m = squash(s).match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  return m ? [m[1].toUpperCase(), m[2].toUpperCase(), m[3]] : [squash(s).toUpperCase(), "", ""];
}

console.log(`Read ${args.in}`);
const text = readFileSync(resolve(args.in), "utf8").replace(/^﻿/, "");
const rows = parseCsv(text);
if (rows.length < 2) throw new Error("no data rows in the export");
const header = rows[0].map((h) => squash(h).toUpperCase());
const col = {};
header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
for (const need of ["VOTER ID", "VOTER NAME", "PRECINCT", "PARTY", "ADDRESS1", "ADDRESS2", "CATEGORY", "CHALLENGED", "DATEISSUED", "DATERETURNED"]) {
  if (!(need in col)) throw new Error(`no '${need}' column in: ${header.join(" | ")}`);
}
const get = (r, name) => squash(r[col[name]]);

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
let returned = 0, challenged = 0, skipped = 0, reissued = 0;
const unknown = new Map();
const byCode = new Map();
let latest = "";

// The Board lists a reissued ballot as a second row for the same voter
// (1,131 voters on 26 Oct 2026). One row per voter, as the platform does:
// the returned one if either came back, otherwise the later issue.
const byVoter = new Map();
for (const r of rows.slice(1)) {
  const id = get(r, "VOTER ID");
  if (!/^\d+$/.test(id)) { skipped++; continue; }
  const prev = byVoter.get(id);
  if (!prev) { byVoter.set(id, r); continue; }
  reissued++;
  const rank = (x) => (mdy(get(x, "DATERETURNED")) ? "2" : "1") + mdy(get(x, "DATEISSUED")).replace(/^(\d+)\/(\d+)\/(\d+)$/, (_, m, d, y) => `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}`);
  if (rank(r) > rank(prev)) byVoter.set(id, r);
}
for (const r of byVoter.values()) {
  const id = get(r, "VOTER ID");
  const [last, first, middle, suffix] = splitName(get(r, "VOTER NAME"));
  const code = get(r, "CATEGORY").toUpperCase();
  byCode.set(code, (byCode.get(code) ?? 0) + 1);
  const appType = CATEGORY[code];
  if (!appType) unknown.set(code, (unknown.get(code) ?? 0) + 1);
  const issued = mdy(get(r, "DATEISSUED"));
  const ret = mdy(get(r, "DATERETURNED"));
  const challenge = get(r, "CHALLENGED").toUpperCase();
  if (ret) returned++;
  if (ret && challenge) challenged++;
  for (const d of [issued, ret]) {
    const iso = d && d.replace(/^(\d+)\/(\d+)\/(\d+)$/, (_, m, dd, y) => `${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`);
    if (iso && iso > latest) latest = iso;
  }
  // Where the ballot went: the Mail* columns when the Board filled them,
  // otherwise the registration address.
  let street = get(r, "MAILSTREET"), city = get(r, "MAILCITY"), state = get(r, "MAILSTATE"), zip = get(r, "MAILZIP");
  const country = get(r, "MAILCOUNTRY");
  if (!street) {
    street = get(r, "ADDRESS1");
    [city, state, zip] = splitCsz(get(r, "ADDRESS2"));
  }
  const inPerson = appType === "IN OFFICE";
  const row = [
    last, first, middle, suffix,
    PARTY[get(r, "PARTY").toUpperCase()] ?? get(r, "PARTY").toUpperCase(),
    String(Number(id)),
    street.toUpperCase(), get(r, "CAREOF") ? `C/O ${get(r, "CAREOF").toUpperCase()}` : "",
    city.toUpperCase(), state.toUpperCase().slice(0, 2), zip.slice(0, 5), /^(US|USA|UNITED STATES)?$/i.test(country) ? "" : country.toUpperCase(),
    issued, ret,
    ret ? (inPerson ? "CAST IN PERSON" : "MAILED") : "NOT RECEIVED",
    appType ?? code,
    get(r, "PRECINCT"),
    issued,
    ret ? (challenge || "VALID") : "",
    code,
  ];
  out.push(row.map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${(rows.length - 1).toLocaleString()} rows -> ${(out.length - 1).toLocaleString()} voters (${reissued.toLocaleString()} reissued ballots collapsed), ${returned.toLocaleString()} returned (${challenged.toLocaleString()} of them challenged)${skipped ? `, ${skipped} rows skipped` : ""}; latest date ${latest}`);
console.log("  by Board code: " + [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(", "));
if (unknown.size) console.log(`  ::warning title=Cuyahoga absentee::unmapped category code(s): ${[...unknown.entries()].map(([c, n]) => `${c} (${n})`).join(", ")} - passed through as-is; add them to CATEGORY in fetch-absentee-cuyahoga.mjs`);
console.log(`::notice title=Absentee data::Cuyahoga BOE export, ${out.length - 1} ballots, data through ${latest}`);
