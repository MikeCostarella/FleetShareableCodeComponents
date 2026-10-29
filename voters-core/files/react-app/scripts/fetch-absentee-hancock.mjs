/**
 * Hancock County Board of Elections: build one early-vote file from the
 * Board's Google-Sheet absentee lists, in the state platform's column layout,
 * which scripts/lib/absentee.mjs already reads.
 *
 *   node scripts/fetch-absentee-hancock.mjs --page=https://hancockcountyohioelections.gov/absentee-lists/ "--out=../SourceData/HancockCounty_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-hancock.mjs --in=<folder> "--out=..."     (the two files already downloaded)
 *
 * refresh-absentee.ps1 runs it when react-app/absentee-source.json says
 *   { "fetcher": "script", "script": "fetch-absentee-hancock.mjs", "pageUrl": "https://hancockcountyohioelections.gov/absentee-lists/" }
 *
 * THE PAGE (WordPress, recorded 29 Oct 2026) "Absentee Lists" links Google
 * Sheets exports - no login:
 *   - "ABSENTEES BY MAIL RETURNED - DOWNLOAD LIST: CSV": the FIRST "CSV" link on
 *     the page, docs.google.com/spreadsheets/d/<id>/export?format=csv. Despite
 *     its name it is EVERY returned ballot, cumulative - in office (TYPE OFF,
 *     7,572 on 29 Oct), by mail, nursing home, e-mail, hand carried.
 *     Columns: CAT, TYPE, RETURN DATE (m/d/yy), STATE ID# (the SoS voter id,
 *     "OH0026947996" - NOT the county id), LAST, FIRST, MIDDLE, SUFFIX,
 *     MAILED TO, CITY - STATE - ZIP ("FINDLAY OH 45840"), PRECINCT # (701),
 *     PARTY (D R L NP).
 *   - the "DOWNLOAD ENTIRE LIST" row of the daily-lists table: XLSX under VOTE
 *     BY MAIL REQUESTS (first) and IN OFFICE ABSENTEES (second), each a
 *     www.google.com/url?q= redirect to a docs.google.com .../export?format=xlsx
 *     of a workbook with ONE SHEET PER DAY ("2026.10.06" ...). The requests
 *     workbook is every mail ballot issued (DATE ENTERED; 3,218 on 29 Oct, 2,420
 *     of them in the returned list); the in-office workbook is a subset of the
 *     returned list, so it is not needed.
 *     That table is a Ninja Tables table: the HTML holds only an empty
 *     <table id="footable_2842">, and the browser loads its rows from
 *     wp-admin/admin-ajax.php (public, no nonce). So this script asks
 *     admin-ajax.php for them too (entireListXlsx below).
 *
 * VOTER IDS. The Board's lists carry the SoS id; the app keys voters by the
 * county id. The SoS county voter file in ../SourceData (SOS_HANCOCK_<date>.txt,
 * on lvp-01 only - it is gitignored) maps one to the other: 10,840 of 10,842
 * matched on 29 Oct 2026. So this fetcher only runs where that file is.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseCsv } from "./lib/absentee.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const SOURCE = resolve(APP, "..", "SourceData");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
if (!args.out || !(args.page || args.in)) {
  console.error('usage: node scripts/fetch-absentee-hancock.mjs (--page=<Board page url> | --in=<folder>) "--out=../SourceData/HancockCounty_absentee 2026 general.csv"');
  process.exit(2);
}
const OUT = resolve(APP, args.out);
const UA = "HancockCountyVoters absentee refresh (github.com/MikeCostarella)";
const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
const unredirect = (href) => {
  const u = new URL(href.replace(/&amp;/g, "&"));
  return u.host === "www.google.com" && u.pathname === "/url" && u.searchParams.get("q") ? u.searchParams.get("q") : u.toString();
};

// --------------------------------------------------------------- the files ---
async function get(url, what) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`${what}: GET ${new URL(url).host}${new URL(url).pathname}: HTTP ${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) throw new Error(`${what}: Google answered with a web page, not the file (sign-in page? the sheet may no longer be public)`);
  return Buffer.from(await r.arrayBuffer());
}
/** The page's CSV / PDF / XLSX links, in order. */
const anchorsOf = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>\s*(CSV|PDF|XLSX)\s*<\/a>/gi)].map((m) => ({ href: m[1], kind: m[2].toUpperCase(), at: m.index }));
/** A Google Sheets link (direct, or a www.google.com/url?q= redirect) -> a clean export URL for that sheet. */
function sheetExport(href, format) {
  const u = unredirect(href);
  const id = (u.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
  if (!id) return u;
  const gid = (u.match(/[?&#](?:amp;)*gid(?:=|%3D)(\d+)/i) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=${format}${gid ? `&gid=${gid}` : ""}`;
}
/**
 * The XLSX link in the "DOWNLOAD ENTIRE LIST" row, VOTE BY MAIL REQUESTS column.
 * Since 29 Oct 2026 that table is a Ninja Tables table (footable_<id>) whose rows
 * the page loads by AJAX, so they are not in the HTML; ask admin-ajax.php for them
 * (public, no nonce needed). The HTML is still searched first in case the
 * Board goes back to a plain table.
 */
async function entireListXlsx(page, pageUrl) {
  const start = page.search(/DOWNLOAD ENTIRE LIST/i);
  if (start >= 0) {
    const end = page.indexOf("</tr>", start);
    const a = anchorsOf(page.slice(start, end < 0 ? undefined : end)).find((x) => x.kind === "XLSX");
    if (a) return a.href;
  }
  const origin = new URL(pageUrl).origin;
  for (const id of new Set([...page.matchAll(/footable_(\d+)/g)].map((m) => m[1]))) {
    const url = `${origin}/wp-admin/admin-ajax.php?action=wp_ajax_ninja_tables_public_action&table_id=${id}&target_action=get-all-data&default_sorting=old_first&skip_rows=0&limit_rows=0`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) continue;
    let rows;
    try { rows = await r.json(); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    const row = rows.find((x) => x && Object.values(x).some((v) => /DOWNLOAD ENTIRE LIST/i.test(String(v))));
    if (!row) continue;
    const key = Object.keys(row).find((k) => /request/i.test(k)) ?? Object.keys(row)[1];
    const a = anchorsOf(String(row[key] ?? "")).find((x) => x.kind === "XLSX");
    if (a) return a.href;
  }
  return null;
}

async function main() {
  let returnedText, requestsBuf;
  if (args.in) {
    const dir = resolve(args.in);
    const names = readdirSync(dir);
    const pick = (re, what) => { const n = names.find((f) => re.test(f)); if (!n) throw new Error(`no ${what} in ${dir}`); return join(dir, n); };
    returnedText = readFileSync(pick(/^Returned Absentee List.*\.csv$/i, "Returned Absentee List*.csv"), "utf8");
    requestsBuf = readFileSync(pick(/^Vote By Mail Absentee List.*\.xlsx$/i, "Vote By Mail Absentee List*.xlsx"));
  } else {
    const page = await (await fetch(args.page, { headers: { "User-Agent": UA } })).text();
    const firstCsv = anchorsOf(page).find((a) => a.kind === "CSV");
    if (!firstCsv) throw new Error("no CSV link on the page - the page changed");
    const entire = await entireListXlsx(page, args.page);
    if (!entire) throw new Error('no XLSX in the "DOWNLOAD ENTIRE LIST" row (in the page or its Ninja Tables data) - the page changed');
    console.log(`GET ${args.page}: returned list + entire vote-by-mail requests workbook`);
    returnedText = (await get(sheetExport(firstCsv.href, "csv"), "returned list")).toString("utf8");
    requestsBuf = await get(sheetExport(entire, "xlsx"), "requests workbook");
  }

  // ------------------------------------------------------------ SoS id map ---
  const sosFile = (existsSync(SOURCE) ? readdirSync(SOURCE) : []).filter((f) => /^SOS_HANCOCK_\d{4}-\d{2}-\d{2}\.txt$/i.test(f)).sort().pop();
  if (!sosFile) throw new Error(`no SOS_HANCOCK_<date>.txt in ${SOURCE} - it maps the Board's SoS ids to county ids`);
  const sosToCounty = new Map();
  {
    const text = readFileSync(join(SOURCE, sosFile), "latin1");
    const nl = text.indexOf("\n");
    const head = parseCsv(text.slice(0, nl))[0].map((h) => h.toUpperCase());
    const iS = head.indexOf("SOS_VOTERID"), iC = head.indexOf("COUNTY_ID");
    if (iS < 0 || iC < 0) throw new Error(`${sosFile}: no SOS_VOTERID / COUNTY_ID columns`);
    for (const line of text.slice(nl + 1).split(/\r?\n/)) {
      if (!line) continue;
      const f = line.split('","').map((x) => x.replace(/^"|"$/g, ""));
      if (f[iS] && f[iC]) sosToCounty.set(f[iS], String(Number(f[iC])));
    }
  }

  // ------------------------------------------------------------- combine ---
  const PARTY = { D: "DEM", R: "REP", L: "LIB", G: "GRE", NP: "", "": "" };
  function appType(cat, type) {
    if (type === "OFF") return "IN OFFICE";
    if (type === "NH" || cat === "NH") return "NURSING HOME";
    if (type === "HAND" || cat === "HC") return "HAND CARRY";
    if (type === "EMAIL") return "UOCAVA EMAIL";
    if (["F", "M", "MO"].includes(cat)) return "UOCAVA MAIL";
    return "MAIL";
  }
  /** "10/7/26" | Excel serial | Date -> "10/7/2026"; "" when blank. */
  function mdy(v) {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; }
    const m = squash(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return "";
    return `${Number(m[1])}/${Number(m[2])}/${m[3].length === 2 ? "20" + m[3] : m[3]}`;
  }
  const iso = (s) => s.replace(/^(\d+)\/(\d+)\/(\d+)$/, (_, m, d, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);

  const voters = new Map(); // sos id -> record
  const rec = (r, cols) => ({ cat: squash(r[cols.cat]).toUpperCase(), type: squash(r[cols.type]).toUpperCase(),
    last: squash(r[cols.last]), first: squash(r[cols.first]), middle: squash(r[cols.middle]), suffix: squash(r[cols.suffix]),
    street: squash(r[cols.street]), csz: squash(r[cols.csz]), precinct: squash(r[cols.precinct]).replace(/\.0$/, ""), party: squash(r[cols.party]).toUpperCase() });
  const colsOf = (head) => {
    const h = head.map((x) => squash(x).toUpperCase().replace(/:$/, ""));
    const at = (re) => h.findIndex((x) => re.test(x));
    const c = { cat: at(/^CAT$/), type: at(/^TYPE$/), id: at(/^STATE ID/), last: at(/^LAST$/), first: at(/^FIRST$/), middle: at(/^MIDDLE$/), suffix: at(/^SUFFIX$/),
      street: at(/^MAILED TO$/), csz: at(/^CITY/), precinct: at(/^PRECINCT/), party: at(/^PARTY$/), entered: at(/^DATE ENTERED$/), returned: at(/^(RETURN DATE|DATE RETURNED)$/) };
    if (c.id < 0 || c.type < 0) throw new Error(`unexpected columns: ${h.join(" | ")}`);
    return c;
  };
  // mail ballots issued: every sheet of the requests workbook
  let requestRows = 0;
  {
    const wb = XLSX.read(requestsBuf, { type: "buffer", cellDates: false });
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      if (!rows.length) continue;
      const c = colsOf(rows[0]);
      for (const r of rows.slice(1)) {
        const id = squash(r[c.id]).toUpperCase();
        if (!/^OH\d+$/.test(id)) continue;
        requestRows++;
        voters.set(id, { ...rec(r, c), sent: mdy(r[c.entered]), ret: "" });
      }
    }
  }
  // every returned ballot (cumulative CSV)
  let returnedRows = 0;
  {
    const rows = parseCsv(returnedText.replace(/^﻿/, ""));
    const c = colsOf(rows[0]);
    for (const r of rows.slice(1)) {
      const id = squash(r[c.id]).toUpperCase();
      if (!/^OH\d+$/.test(id)) continue;
      returnedRows++;
      const ret = mdy(r[c.returned]);
      const prev = voters.get(id);
      const now = rec(r, c);
      voters.set(id, { ...(prev ?? {}), ...now, sent: prev?.sent || ret, ret });
    }
  }

  const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
    "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE", "SOSID"];
  const out = [HEADER.join(",")];
  let unmatched = 0, returned = 0, latest = "";
  const today = new Date().toISOString().slice(0, 10);
  const byType = new Map();
  for (const [sos, v] of voters) {
    const cid = sosToCounty.get(sos);
    if (!cid) { unmatched++; continue; }
    const t = appType(v.cat, v.type);
    byType.set(t, (byType.get(t) ?? 0) + 1);
    if (v.ret) returned++;
    for (const d of [v.sent, v.ret]) { const i = d && iso(d); if (i && i <= today && i > latest) latest = i; }
    const m = v.csz.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?$/i);
    const [city, state, zip] = m ? [m[1], m[2], m[3]] : [v.csz, "", ""];
    out.push([
      v.last.toUpperCase(), v.first.toUpperCase(), v.middle.toUpperCase(), v.suffix.toUpperCase(),
      PARTY[v.party] ?? "", cid,
      v.street.toUpperCase(), "", city.toUpperCase(), state.toUpperCase(), zip, "",
      v.sent, v.ret,
      v.ret ? (t === "IN OFFICE" ? "CAST IN PERSON" : "MAILED") : "NOT RECEIVED",
      t, v.precinct, v.sent, v.ret ? "VALID" : "", `HANCOCK ${v.cat}/${v.type}`, sos,
    ].map(csv).join(","));
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`  ${requestRows.toLocaleString()} mail ballots issued + ${returnedRows.toLocaleString()} returned ballots -> ${(out.length - 1).toLocaleString()} voters, ${returned.toLocaleString()} returned; latest date ${latest}${unmatched ? `; ${unmatched} SoS id(s) not in ${sosFile}` : ""}`);
  console.log("  by type: " + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(", "));
  console.log(`::notice title=Absentee data::Hancock BOE lists, ${out.length - 1} voters, data through ${latest}`);
}

main().catch((err) => {
  // set the exit code and let Node wind down on its own: process.exit() with fetch
  // sockets still closing trips a libuv assertion on Windows (Node 24).
  console.error(`Error: ${err?.message ?? err}`);
  process.exitCode = 1;
});
