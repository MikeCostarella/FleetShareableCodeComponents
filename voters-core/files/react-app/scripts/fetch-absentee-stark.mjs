/**
 * Convert the Stark County Board of Elections' absentee spreadsheets into one
 * CSV in the state platform's column layout, which scripts/lib/absentee.mjs
 * already reads. The download itself is done by fetch-absentee-browser.mjs
 * (recipe "stark"): the Board's page sits behind Cloudflare, which turns plain
 * requests away (403 whatever the headers, 27 Oct 2026), so a real browser
 * signs in and saves every spreadsheet into a folder; refresh-absentee.ps1
 * runs the two in turn when react-app/absentee-source.json says
 *   { "fetcher": "browser", "recipe": "stark", "siteUrl": "https://builder1.revize.com",
 *     "convert": "fetch-absentee-stark.mjs" }
 *
 *   node scripts/fetch-absentee-stark.mjs --in=<folder of .xlsx> "--out=../SourceData/StarkCounty_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-stark.mjs --page=<url> --out=...   (direct download; only if Cloudflare ever goes away)
 *
 * THE BOARD'S PAGE (Election Operations Manager's guide, Aug 2026; recorded 27 Oct 2026)
 * The "Absentee Download" page sits behind the website's HTTP sign-in, a
 * shared candidate login the Board hands out on request. It lists:
 *   - "Absentee Ballots Returned"           every ballot back at the Board, cumulative
 *   - "Absentee Ballots Mailed <date>"      the ballots mailed that day (current + an archive
 *                                           back to the first day of early voting)
 *   - "City Twp SDAbbrevLst"                the Board's abbreviation key (not needed here)
 * Each is an .xlsx with the same 62 columns: voter_id (the county id the SoS
 * roll uses - 37,847 of 37,851 matched on 27 Oct 2026), State_ID, name parts,
 * the registration address in parts, Mail_* (where the ballot went), Party
 * (NP DEM REP LIB), Category + Source (how the ballot was delivered, below),
 * date_entered ("9/11/26 12:30", the issue date), Date_Returned ("10/13/26",
 * blank while out), Consolidation_Name (the Board's precinct code, "MASS3B";
 * the roll's name is "MASSILLON 3-B" - the converter uses the roll's for every
 * voter it knows). The daily Mailed files hold only ballots not yet returned,
 * so issued = Returned + every Mailed file, one row per voter.
 *
 * THE LOGIN lives in %LOCALAPPDATA%\Statehouse\secrets.json, outside every
 * repo, under "stark-absentee": { "user": "...", "pass": "..." } (or env
 * STARK_ABSENTEE_USER / STARK_ABSENTEE_PASS). A fetch with no login fails
 * with a message saying where to put it.
 *
 * CATEGORY + SOURCE -> the platform application types lib/absentee.mjs maps:
 *   TSX  OFF        taken in office: early in-person           -> IN OFFICE
 *   NF   MAIL/PAPER/REM  ballot mailed                         -> MAIL
 *   NF   HAND       hand carried                               -> HAND CARRY
 *   NH   HAND       nursing home / care facility               -> NURSING HOME
 *   FPO / CO  EMAIL overseas civilian, ballot by e-mail        -> UOCAVA EMAIL
 *   FPO / CO  MAIL  overseas civilian, ballot by mail          -> CIVILIAN OVERSEAS
 *   FPM / AF  EMAIL military, ballot by e-mail                 -> UOCAVA EMAIL
 *   FPM / AF  MAIL  military, ballot by mail                   -> MILITARY
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { squash } from "./lib/absentee.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
if (!args.out) {
  console.error('usage: node scripts/fetch-absentee-stark.mjs (--page=<url> | --in=<dir>) "--out=../SourceData/StarkCounty_absentee 2026 general.csv"');
  process.exit(2);
}
const OUT = resolve(APP, args.out);
const SECRETS = args.secrets
  ? resolve(args.secrets)
  : join(process.env.LOCALAPPDATA || join(process.env.HOME || "", ".config"), "Statehouse", "secrets.json");

function login() {
  if (process.env.STARK_ABSENTEE_USER && process.env.STARK_ABSENTEE_PASS) {
    return { user: process.env.STARK_ABSENTEE_USER, pass: process.env.STARK_ABSENTEE_PASS };
  }
  try {
    const s = JSON.parse(readFileSync(SECRETS, "utf8"))["stark-absentee"];
    if (s?.user && s?.pass) return s;
  } catch { /* fall through */ }
  throw new Error(`no Stark login: add "stark-absentee": { "user": "...", "pass": "..." } to ${SECRETS} (the Board's candidate login, from its absentee guide)`);
}

// ------------------------------------------------------------- download ---

/** [{ kind: "returned" | "mailed", label, buffer }] from the Board's page, or from --in. */
async function collect() {
  const files = [];
  if (args.in) {
    const dir = resolve(APP, args.in);
    for (const f of readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f))) {
      const buffer = readFileSync(join(dir, f));
      const c = classify(buffer, f);
      if (c) files.push({ kind: c.kind, sheet: c.sheet, label: f, buffer });
      else console.log(`  ${f}: not one of the Board's absentee spreadsheets - skipped`);
    }
    if (!files.length) throw new Error(`no Stark absentee spreadsheets in ${dir}`);
    return files;
  }
  const page = args.page;
  if (!page) throw new Error("--page or --in is required");
  const { user, pass } = login();
  const headers = { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"), "User-Agent": "Mozilla/5.0 (StarkCountyVoters fetcher)" };
  const res = await fetch(page, { headers, redirect: "follow" });
  if (res.status === 401 || res.status === 403) throw new Error(`the Board's page refused the login (${res.status}) - check "stark-absentee" in ${SECRETS}`);
  if (!res.ok) throw new Error(`page ${res.status} ${res.statusText}`);
  const html = await res.text();
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = squash(m[2].replace(/<[^>]+>/g, ""));
    const kind = /absentee ballots returned/i.test(text) ? "returned" : /absentee ballots mailed/i.test(text) ? "mailed" : null;
    if (kind) links.push({ kind, label: text, url: new URL(m[1].replace(/&amp;/g, "&"), page).href });
  }
  if (!links.some((l) => l.kind === "returned")) throw new Error(`no "Absentee Ballots Returned" link on ${page} - the Board's page changed`);
  console.log(`  ${links.length} spreadsheet(s) linked: ${links.filter((l) => l.kind === "mailed").length} daily Mailed + Returned`);
  for (const l of links) {
    const r = await fetch(l.url, { headers, redirect: "follow" });
    if (!r.ok) throw new Error(`${l.label}: ${r.status} ${r.statusText} (${l.url})`);
    const buffer = Buffer.from(await r.arrayBuffer());
    const c = classify(buffer, l.label);
    if (!c) throw new Error(`${l.label}: not a spreadsheet with the Board's columns (${l.url})`);
    files.push({ kind: l.kind, sheet: c.sheet, label: l.label, buffer });
  }
  return files;
}

/**
 * { kind: "returned" | "mailed", sheet } for a workbook with the Board's
 * columns on some sheet, else null. The kind comes from the sheet's name,
 * then the file's; a sheet with the columns and no telling name is a daily
 * Mailed file (the Returned one is always named).
 */
function classify(buffer, label = "") {
  let wb;
  try { wb = XLSX.read(buffer, { type: "buffer" }); } catch { return null; }
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", range: 0 });
    const head = (rows[0] ?? []).map((h) => squash(h));
    if (!head.includes("voter_id") || !head.includes("Date_Returned")) continue;
    const hint = `${name} ${label}`;
    return { kind: /returned/i.test(hint) ? "returned" : "mailed", sheet: name };
  }
  return null;
}

// -------------------------------------------------------------- convert ---

const APPTYPE = (category, source) => {
  const c = category.toUpperCase(), s = source.toUpperCase();
  if (c === "TSX") return "IN OFFICE";
  if (c === "NF") return s === "HAND" ? "HAND CARRY" : "MAIL";
  if (c === "NH") return "NURSING HOME";
  if (c === "FPO" || c === "CO") return s === "EMAIL" ? "UOCAVA EMAIL" : "CIVILIAN OVERSEAS";
  if (c === "FPM" || c === "AF") return s === "EMAIL" ? "UOCAVA EMAIL" : "MILITARY";
  return null;
};
const PARTY = { NP: "", DEM: "DEM", REP: "REP", LIB: "LIB", GRE: "GRE" };

/** "9/11/26 12:30" or "10/13/26" -> "9/11/2026"; "" when blank. */
function mdy(s) {
  const m = squash(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${Number(m[1])}/${Number(m[2])}/${y}`;
}
const sortable = (d) => d.replace(/^(\d+)\/(\d+)\/(\d+)$/, (_, m, dd, y) => `${y}${m.padStart(2, "0")}${dd.padStart(2, "0")}`);
const csv = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const files = await collect();
const byVoter = new Map(); // id -> { r, returned }
let rowsIn = 0, dupes = 0, skipped = 0;
for (const f of files.sort((a, b) => (a.kind === "returned" ? -1 : 1) - (b.kind === "returned" ? -1 : 1))) {
  const wb = XLSX.read(f.buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[f.sheet], { header: 1, raw: false, defval: "" });
  const head = rows[0].map((h) => squash(h));
  const col = {};
  head.forEach((h, i) => { if (!(h in col)) col[h] = i; });
  for (const need of ["voter_id", "name_last", "name_first", "Party", "Category", "Source", "date_entered", "Date_Returned", "Mail_Street", "Mail_City", "Mail_State", "Mail_Zip"]) {
    if (!(need in col)) throw new Error(`${f.label}: no '${need}' column`);
  }
  console.log(`  ${f.label}: ${(rows.length - 1).toLocaleString()} rows`);
  for (const r of rows.slice(1)) {
    rowsIn++;
    const get = (n) => squash(r[col[n]]);
    const id = get("voter_id");
    if (!/^\d+$/.test(id)) { skipped++; continue; }
    const returned = mdy(get("Date_Returned")) !== "";
    const prev = byVoter.get(id);
    if (prev) {
      dupes++;
      // A returned row always wins; among unreturned rows the later issue does.
      if (prev.returned || (!returned && sortable(mdy(get("date_entered"))) <= sortable(mdy(prev.get("date_entered"))))) continue;
    }
    byVoter.set(id, { get, returned });
  }
}

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
let returnedN = 0, latest = "";
const unknown = new Map();
const byCode = new Map();
for (const [id, { get }] of byVoter) {
  const category = get("Category"), source = get("Source");
  const code = `${category}|${source}`;
  byCode.set(code, (byCode.get(code) ?? 0) + 1);
  const appType = APPTYPE(category, source);
  if (!appType) unknown.set(code, (unknown.get(code) ?? 0) + 1);
  const issued = mdy(get("date_entered"));
  const ret = mdy(get("Date_Returned"));
  if (ret) returnedN++;
  for (const d of [issued, ret]) { const s = d && sortable(d); if (s && s > latest) latest = s; }
  const inPerson = appType === "IN OFFICE";
  const country = get("Mail_Country");
  const row = [
    get("name_last").toUpperCase(), get("name_first").toUpperCase(), get("name_middle").toUpperCase(), get("name_suffix").toUpperCase(),
    PARTY[get("Party").toUpperCase()] ?? get("Party").toUpperCase(),
    String(Number(id)),
    get("Mail_Street").toUpperCase(), get("Mailing_Address").toUpperCase(),
    get("Mail_City").toUpperCase(), get("Mail_State").toUpperCase().slice(0, 2), get("Mail_Zip").slice(0, 5),
    /^(US|USA|UNITED STATES)?$/i.test(country) ? "" : country.toUpperCase(),
    issued, ret,
    ret ? (inPerson ? "CAST IN PERSON" : source.toUpperCase() === "HAND" ? "O T C/ PERSONAL DELIVERY" : "MAILED") : "NOT RECEIVED",
    appType ?? code,
    get("Consolidation_Name"),
    issued,
    ret ? (get("Challenged") || "VALID") : "",
    code,
  ];
  out.push(row.map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
const latestIso = latest ? `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}` : "";
console.log(`Wrote ${OUT}`);
console.log(`  ${rowsIn.toLocaleString()} rows in ${files.length} spreadsheet(s) -> ${(out.length - 1).toLocaleString()} voters (${dupes.toLocaleString()} repeats collapsed), ${returnedN.toLocaleString()} returned${skipped ? `, ${skipped} rows skipped` : ""}; latest date ${latestIso}`);
console.log("  by Board code: " + [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n.toLocaleString()}`).join(", "));
if (unknown.size) console.log(`  ::warning title=Stark absentee::unmapped category(s): ${[...unknown.entries()].map(([c, n]) => `${c} (${n})`).join(", ")} - passed through as-is; add them to APPTYPE in fetch-absentee-stark.mjs`);
console.log(`::notice title=Absentee data::Stark BOE spreadsheets, ${out.length - 1} ballots, data through ${latestIso}`);
