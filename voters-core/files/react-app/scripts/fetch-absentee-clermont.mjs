/**
 * Convert the Clermont County Board of Elections' two candidate-tool reports
 * into one CSV in the state platform's column layout, which
 * scripts/lib/absentee.mjs already reads. The downloads are done by
 * fetch-absentee-browser.mjs (recipe "clermont"): both are forms that POST and
 * return an .xlsx; refresh-absentee.ps1 runs the two in turn when
 * react-app/absentee-source.json says
 *   { "fetcher": "browser", "recipe": "clermont", "siteUrl": "https://clermontcountyohio.gov",
 *     "convert": "fetch-absentee-clermont.mjs" }
 *
 *   node scripts/fetch-absentee-clermont.mjs --in=<folder with the two .xlsx> "--out=../SourceData/ClermontCounty_absentee 2026 general.csv"
 *
 * THE BOARD'S PAGES (recorded 27 Oct 2026, no login)
 *   /BOECandidateTool/Home/BallotTracking      "Returned Voted Ballots Tracking Report":
 *     election + start/end date -> ballot-tracking.xlsx, sheet "Ballot Tracking",
 *     the VoterView layout (Category, Org, Issued, AV ID, Returned, BT, Party,
 *     Name, Mailed To, City State Zip, Cons, Precinct, State ID, Voter ID) -
 *     one row per RETURNED ballot, and unlike Trumbull's export it carries the
 *     county Voter ID, so no name matching.
 *   /BOECandidateTool/Home/AbsenteeMailingLabel "Absentee Voter Mailing Labels Report":
 *     election, ALL parties, Show Party and Precinct, start/end date,
 *     COUNTYWIDE, EXCEL, voting procedure All -> absentee-mailing.xlsx, sheet
 *     "Absentee Mailing" (Election ID, Voter ID, Name, Date Entered, Address,
 *     Apt Number, City, State, Zip, State ID, Party, Precinct) - one row per
 *     ballot REQUESTED (mail and in-office), updated by 5 pm daily.
 *   Issued = every voter in the mailing file (plus any returned voter the
 *   mailing file lacks); returned = the tracking file.
 *
 * CATEGORY/ORG (tracking file) -> platform application types:
 *   PAPER OFF, EV OFF  early in-person          -> IN OFFICE
 *   NF MAIL            mail                     -> MAIL
 *   NF HAND            hand carried             -> HAND CARRY
 *   CRB CURB           curbside                 -> CURBSIDE
 *   HOME HAND          ballot taken to the home -> HAND CARRY
 *   NH *               nursing home             -> NURSING HOME
 *   CO EML / CO MAIL   civilian overseas        -> UOCAVA EMAIL / CIVILIAN OVERSEAS
 *   MI EML / MI MAIL   military                 -> UOCAVA EMAIL / MILITARY
 *   DS EML             accessible (disability) ballot by e-mail -> ACCESSIBLE BALLOT
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { squash } from "./lib/absentee.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
if (!args.in || !args.out) { console.error('usage: node scripts/fetch-absentee-clermont.mjs --in=<folder> "--out=../SourceData/ClermontCounty_absentee 2026 general.csv"'); process.exit(2); }
const OUT = resolve(APP, args.out);
const DIR = resolve(APP, args.in);

function sheetRows(file) {
  const wb = XLSX.read(readFileSync(file), { type: "buffer" });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    if (rows.length > 1) return rows.map((r) => r.map((c) => squash(c)));
  }
  return [];
}
let tracking = null, mailing = null;
for (const f of readdirSync(DIR).filter((f) => /\.xlsx?$/i.test(f))) {
  const rows = sheetRows(join(DIR, f));
  const head = rows[0] ?? [];
  if (head.includes("AV ID") && head.includes("Returned")) tracking = { file: f, rows };
  else if (head.includes("Date Entered") && head.includes("Voter ID")) mailing = { file: f, rows };
  else console.log(`  ${f}: not one of the Board's two reports - skipped`);
}
if (!tracking) throw new Error(`no ballot-tracking spreadsheet (AV ID / Returned columns) in ${DIR}`);
if (!mailing) throw new Error(`no absentee-mailing spreadsheet (Voter ID / Date Entered columns) in ${DIR}`);
console.log(`  ${tracking.file}: ${(tracking.rows.length - 1).toLocaleString()} returned rows; ${mailing.file}: ${(mailing.rows.length - 1).toLocaleString()} requested rows`);

const col = (rows) => { const c = {}; rows[0].forEach((h, i) => { if (!(h in c)) c[h] = i; }); return c; };
const APPTYPE = (cat, org) => {
  cat = cat.toUpperCase(); org = org.toUpperCase();
  if (cat === "PAPER" || cat === "EV" || cat === "EVOFF" || org === "OFF") return "IN OFFICE";
  if (cat === "CRB" || org === "CURB") return "CURBSIDE";
  if (cat === "NH") return "NURSING HOME";
  if (cat === "HOME" || org === "HAND" || org === "HCO") return "HAND CARRY";
  if (cat === "CO") return org === "EML" ? "UOCAVA EMAIL" : "CIVILIAN OVERSEAS";
  if (cat === "MI" || cat === "MIL") return org === "EML" ? "UOCAVA EMAIL" : "MILITARY";
  if (cat === "DS") return "ACCESSIBLE BALLOT"; // disability: ballot delivered electronically
  if (cat === "NF" || org === "MAIL") return "MAIL";
  return null;
};
const PARTY = { NOPTY: "", "NO PARTY": "", NON: "", DEM: "DEM", REP: "REP", LIB: "LIB", GRE: "GRE" };
function mdy(s) { const m = squash(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ""; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${Number(m[1])}/${Number(m[2])}/${y}`; }
const sortable = (d) => d.replace(/^(\d+)\/(\d+)\/(\d+)$/, (_, m, dd, y) => `${y}${m.padStart(2, "0")}${dd.padStart(2, "0")}`);
const csv = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** "TAIT, CYNTHIA A" -> [last, first, middle, suffix]; "MARGARET BEAGLE" -> the same from a FIRST ... LAST string. */
const SUFFIX = /^(JR|SR|II|III|IV|V)\.?$/i;
function splitName(name) {
  const s = squash(name).replace(/\./g, "").toUpperCase();
  if (s.includes(",")) {
    const [last, rest] = s.split(",", 2).map((x) => x.trim());
    const parts = rest.split(" ").filter(Boolean);
    let suffix = ""; if (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();
    return [last, parts[0] ?? "", parts.slice(1).join(" "), suffix];
  }
  const parts = s.split(" ").filter(Boolean);
  let suffix = ""; if (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();
  const last = parts.pop() ?? ""; const first = parts.shift() ?? "";
  return [last, first, parts.join(" "), suffix];
}
function splitCsz(s) { const m = squash(s).match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/); return m ? [m[1].toUpperCase(), m[2].toUpperCase(), m[3]] : [squash(s).toUpperCase(), "", ""]; }

const voters = new Map(); // id -> row fields
const tc = col(tracking.rows), mc = col(mailing.rows);
const byCode = new Map(); const unknown = new Map();
let latest = "", returned = 0;
for (const r of mailing.rows.slice(1)) {
  const id = r[mc["Voter ID"]]; if (!/^\d+$/.test(id)) continue;
  const issued = mdy(r[mc["Date Entered"]]);
  const prev = voters.get(id);
  if (prev && sortable(prev.issued) >= sortable(issued)) continue; // keep the latest request per voter
  const [last, first, middle, suffix] = splitName(r[mc["Name"]]);
  voters.set(id, { id, last, first, middle, suffix, party: PARTY[r[mc["Party"]].toUpperCase()] ?? r[mc["Party"]].toUpperCase(),
    street: `${r[mc["Address"]]} ${r[mc["Apt Number"]] ?? ""}`.trim().toUpperCase(), city: r[mc["City"]].toUpperCase(), state: r[mc["State"]].toUpperCase().slice(0, 2), zip: r[mc["Zip"]].slice(0, 5),
    precinct: r[mc["Precinct"]], issued, ret: "", appType: "MAIL", code: "requested" });
}
for (const r of tracking.rows.slice(1)) {
  const id = r[tc["Voter ID"]]; if (!/^\d+$/.test(id)) continue;
  const cat = r[tc["Category"]], org = r[tc["Org"]]; const code = `${cat}|${org}`;
  byCode.set(code, (byCode.get(code) ?? 0) + 1);
  const appType = APPTYPE(cat, org); if (!appType) unknown.set(code, (unknown.get(code) ?? 0) + 1);
  const ret = mdy(r[tc["Returned"]]); const issued = mdy(r[tc["Issued"]]);
  const v = voters.get(id) ?? (() => { const [last, first, middle, suffix] = splitName(r[tc["Name"]]); const [city, state, zip] = splitCsz(r[tc["City State Zip"]]);
    const nv = { id, last, first, middle, suffix, party: PARTY[r[tc["Party"]].toUpperCase()] ?? r[tc["Party"]].toUpperCase(), street: r[tc["Mailed To"]].toUpperCase(), city, state, zip, precinct: r[tc["Precinct"]], issued: "", ret: "" }; voters.set(id, nv); return nv; })();
  v.ret = ret; v.issued = v.issued || issued; v.appType = appType ?? code; v.code = code; v.inPerson = appType === "IN OFFICE" || appType === "CURBSIDE"; v.hand = /HAND/.test(org.toUpperCase());
  if (ret) returned++;
}
for (const v of voters.values()) for (const d of [v.issued, v.ret]) { const s = d && sortable(d); if (s && s > latest) latest = s; }

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE", "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
for (const v of voters.values()) {
  out.push([v.last, v.first, v.middle, v.suffix, v.party, String(Number(v.id)), v.street, "", v.city, v.state, v.zip, "", v.issued, v.ret,
    v.ret ? (v.inPerson ? "CAST IN PERSON" : v.hand ? "O T C/ PERSONAL DELIVERY" : "MAILED") : "NOT RECEIVED", v.appType, v.precinct, v.issued, v.ret ? "VALID" : "", v.code].map(csv).join(","));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
const latestIso = latest ? `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}` : "";
console.log(`Wrote ${OUT}`);
console.log(`  ${(out.length - 1).toLocaleString()} voters, ${returned.toLocaleString()} returned; latest date ${latestIso}`);
console.log("  by Board code: " + [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(", "));
if (unknown.size) console.log(`  ::warning title=Clermont absentee::unmapped category(s): ${[...unknown.entries()].map(([c, n]) => `${c} (${n})`).join(", ")}`);
console.log(`::notice title=Absentee data::Clermont BOE reports, ${out.length - 1} ballots, data through ${latestIso}`);
