/**
 * Ottawa County Board of Elections: build one early-vote file from the
 * Board's DAILY absentee lists, in the state platform's column layout, which
 * scripts/lib/absentee.mjs already reads.
 *
 *   node scripts/fetch-absentee-ottawa.mjs --page=https://boe.ottawa.oh.gov/absentee-ballot-requests/ "--out=../SourceData/OttawaCounty_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-ottawa.mjs --in=<folder of the daily .xlsx> "--out=..."     (files already downloaded)
 *
 * refresh-absentee.ps1 runs it when react-app/absentee-source.json says
 *   { "fetcher": "script", "script": "fetch-absentee-ottawa.mjs", "pageUrl": "https://boe.ottawa.oh.gov/absentee-ballot-requests/" }
 *
 * THE PAGE (WordPress, plain links, no login or bot check; recorded 29 Oct 2026)
 * "Absentee Ballot Requests" lists one link per working day of early voting,
 * the link text being the day's count ("Oct. 28 - 310"), to
 * /wp-content/uploads/<yyyy>/<mm>/Absentee-Request-<m>-<d>-<yyyy>.xlsx. The file
 * names are not regular (Oct 6's is "...-10-2-2026.xlsx", Oct 21's
 * "...-10-21-2026-2.xlsx"), so every .xlsx link on the page is taken as it is.
 *
 * THE FILES. Each is ONE DAY'S ACTIVITY, not a running total: the ballots
 * mailed that day (no returned date yet), the mail ballots that came back that
 * day, and the voters who voted in person that day. A voter whose ballot was
 * mailed on one day and came back on another is in both files. One sheet, one
 * row per voter, 18 columns by position (the header row has typos that vary
 * by day - "Citt", "Methos", "Precicnt", once a stray 19th column - so the
 * columns are read by POSITION and only checked loosely by name):
 *   0 Election ("2026 General")  1 Registrant ID (the county id the SoS roll
 *   calls COUNTY_ID - 7,250 of 7,251 matched on 29 Oct 2026)  2 last  3 first
 *   4 middle  5 Suffix  6-9 address lines (8 is sometimes a country)
 *   10 City  11 State  12 Zip  13 Precinct ("Cat Is 1" - the Board's short
 *   names, not the SoS ones)  14 App Received  15 Ballot Sent  16 Ballot
 *   Returned (Excel date-times; blank = still out)  17 Method: In Person,
 *   Mail, UOCAVA, Carry Out (picked up at the Board, returned later), or
 *   blank (seen on in-person rows: sent and returned the same instant).
 *
 * Combining them: one row per voter, keeping the row with a returned date if
 * any day has one, else the latest mailing. 18 files on 29 Oct 2026 ->
 * 7,251 voters (the page's own total said 7,293 requested).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
if (!args.out || !(args.page || args.in)) {
  console.error('usage: node scripts/fetch-absentee-ottawa.mjs (--page=<Board page url> | --in=<folder>) "--out=../SourceData/OttawaCounty_absentee 2026 general.csv"');
  process.exit(2);
}
const OUT = resolve(APP, args.out);
const UA = "OttawaCountyVoters absentee refresh (github.com/MikeCostarella)";
const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

// ------------------------------------------------------------ the files ---
/** [{ name, buffer }] - from the Board's page, or a local folder. */
async function getFiles() {
  if (args.in) {
    const dir = resolve(args.in);
    const names = readdirSync(dir).filter((f) => /^Absentee-Request-.*\.xlsx$/i.test(f) && !/\(\d+\)\.xlsx$/i.test(f));
    return names.sort().map((name) => ({ name, buffer: readFileSync(join(dir, name)) }));
  }
  const res = await fetch(args.page, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${args.page}: HTTP ${res.status}`);
  const html = await res.text();
  const links = [...new Set([...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => new URL(m[1].replace(/&amp;/g, "&"), args.page).toString()))];
  if (!links.length) throw new Error(`no .xlsx links on ${args.page} - the page changed`);
  console.log(`GET ${args.page}: ${links.length} daily file(s)`);
  const files = [];
  for (const url of links) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: args.page } });
    if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
    files.push({ name: basename(new URL(url).pathname), buffer: Buffer.from(await r.arrayBuffer()) });
  }
  return files;
}

/** Excel serial date-time -> "m/d/yyyy" (lib/absentee.mjs reads m/d/y) and a sortable key; "" when blank. */
function excelDate(v) {
  if (v === null || v === undefined || v === "") return { mdy: "", key: "" };
  if (typeof v === "number") {
    const ms = Math.round((v - 25569) * 86400000);   // 25569 = 1970-01-01 in Excel's 1900 system
    const d = new Date(ms);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return { mdy: `${m}/${day}/${y}`, key: d.toISOString().slice(0, 19), iso: d.toISOString().slice(0, 10) };
  }
  const m = squash(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { mdy: `${Number(m[1])}/${Number(m[2])}/${m[3]}`, key: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, iso: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` };
  return { mdy: "", key: "" };
}

const APP_TYPE = { "IN PERSON": "IN OFFICE", MAIL: "MAIL", UOCAVA: "UOCAVA MAIL", "CARRY OUT": "HAND CARRY" };

// ------------------------------------------------------------- combine ---
const files = await getFiles();
const byVoter = new Map();
const perFile = [];
let rowsIn = 0;
for (const f of files) {
  const wb = XLSX.read(f.buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const head = (rows[0] || []).map((h) => squash(h).toLowerCase());
  const loose = (i, re) => re.test(head[i] || "");
  if (!(loose(1, /registrant/) && loose(15, /sent/) && loose(16, /return/) && loose(17, /meth/))) {
    throw new Error(`${f.name}: unexpected columns: ${head.join(" | ")}`);
  }
  let n = 0;
  for (const r of rows.slice(1)) {
    const id = squash(r[1]);
    if (!/^\d+$/.test(id)) continue;
    n++; rowsIn++;
    const sent = excelDate(r[15]), ret = excelDate(r[16]);
    const rank = (ret.key ? "2" : "1") + (ret.key || sent.key) + f.name;
    const prev = byVoter.get(id);
    if (!prev || rank > prev.rank) byVoter.set(id, { rank, r, sent, ret, app: excelDate(r[14]), file: f.name });
  }
  perFile.push(`${f.name.replace(/^Absentee-Request-|\.xlsx$/gi, "")} ${n}`);
}

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
const byType = new Map();
let returned = 0, latest = "";
const today = new Date().toISOString().slice(0, 10);
for (const [id, v] of byVoter) {
  const { r, sent, ret, app } = v;
  let method = squash(r[17]).toUpperCase();
  // A blank Method has so far only been an in-person vote: sent and returned the same instant.
  if (!method) method = ret.key && ret.key === sent.key ? "IN PERSON" : "MAIL";
  const appType = APP_TYPE[method] ?? method;
  byType.set(appType, (byType.get(appType) ?? 0) + 1);
  if (ret.key) returned++;
  for (const d of [sent.iso, ret.iso]) if (d && d <= today && d > latest) latest = d;
  const line3 = squash(r[8]);
  const country = line3 && !/\d/.test(line3) && !squash(r[9]) ? line3.toUpperCase() : "";
  out.push([
    squash(r[2]).toUpperCase(), squash(r[3]).toUpperCase(), squash(r[4]).toUpperCase(), squash(r[5]).toUpperCase(),
    "",                                   // party: not in the Board's lists; the roll has it
    String(Number(id)),
    squash(r[6]).toUpperCase(), [squash(r[7]), country ? "" : line3].filter(Boolean).join(" ").toUpperCase(),
    squash(r[10]).toUpperCase(), squash(r[11]).toUpperCase().slice(0, 2), squash(r[12]).slice(0, 5), country,
    sent.mdy, ret.mdy,
    ret.key ? (appType === "IN OFFICE" ? "CAST IN PERSON" : "MAILED") : "NOT RECEIVED",
    appType,
    squash(r[13]).toUpperCase(),
    app.mdy,
    ret.key ? "VALID" : "",
    `OTTAWA ${v.file.replace(/^Absentee-Request-|\.xlsx$/gi, "")}`,
  ].map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${files.length} daily files (${perFile.join(", ")})`);
console.log(`  ${rowsIn.toLocaleString()} rows -> ${(out.length - 1).toLocaleString()} voters, ${returned.toLocaleString()} returned; latest date ${latest}`);
console.log("  by type: " + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(", "));
console.log(`::notice title=Absentee data::Ottawa BOE daily lists, ${out.length - 1} voters, data through ${latest}`);
