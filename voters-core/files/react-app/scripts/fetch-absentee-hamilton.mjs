/**
 * Download the Hamilton County Board of Elections' absentee / early-voter
 * list and write it to SourceData/ as a CSV in the state platform's column
 * layout, which scripts/lib/absentee.mjs already reads. The fifth fetcher;
 * refresh-absentee.ps1 picks it when react-app/absentee-source.json says
 * { "fetcher": "hamilton", "siteUrl": "https://votehamiltoncountyohio.gov" }.
 *
 *   node scripts/fetch-absentee-hamilton.mjs --site=https://votehamiltoncountyohio.gov "--out=../SourceData/HamiltonCounty_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-hamilton.mjs --in=<AbsenteeListExport-....csv> --out=...   (a file already exported by hand)
 *
 * HOW THE DOWNLOAD WORKS (recorded from the browser, 25 Oct 2026)
 * The Board's "Absentee & Early Voting Lists" page is a form over a small
 * WordPress API; nothing is signed or cookied:
 *   1. GET  /wp-json/boe-api/v1/get-elections?all=true
 *        -> [{ "Name": "2026 General Election", "ElectionId": "261103" }, ...]
 *      The first entry is the current election (the id is its date, yymmdd).
 *   2. POST /wp-json/boe-api/v1/export-absentee-lists   (form-encoded)
 *        exportMethod=csv&ElectionId=261103&Application=&Exclude=&RequestedStartDate=
 *        &RequestedEndDate=&pParty=&OfficeCode=&SortBy=pn
 *        -> { "filename": "AbsenteeListExport-6ade867345b60.csv", "count": 87186 }
 *      Blank filters = every application of every type, returned or not.
 *      The export takes the server ~25 s.
 *   3. GET  /download.php?file=<that filename>  -> the CSV.
 * The site says it is "updated daily between 8am and 9am", and locks during
 * that window (check-maintenance-lock answers true) - the 8:12 AM task may
 * land inside it; the evening run will not.
 *
 * THE FILE: Request Application Date, Return Ballot Date (blank = still out),
 * electionid, VoterId (the county id the SoS roll uses - 87,186 of 87,186
 * matched), PrecinctName, First/Middle/Last/SuffixName, Address1-6,
 * CityState ("ADDYSTON OH"), Zip, districts..., AbsenteeParty, VoterParty
 * (U D R L), Phone, BirthYear, OVID (the SoS id). There is no column saying
 * how the ballot was cast; a ballot returned the day it was requested is
 * taken as early in-person, any other return as by mail.
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
if (!OUT || !(args.site || args.in)) {
  console.error("usage: fetch-absentee-hamilton.mjs (--site=<board site url> | --in=<exported csv>) --out=<csv path>");
  process.exit(2);
}

const UA = "CountyVoters absentee refresh (github.com/MikeCostarella)";
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

// ------------------------------------------------------------- download ---

async function api(site, path, init = {}) {
  const url = `${site.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${site.replace(/\/$/, "")}/campaign-media/absentee-lists/`,
      ...(init.headers ?? {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res;
}

async function download(site) {
  const base = site.replace(/\/$/, "");
  const locked = await (await api(site, "/wp-json/boe-api/v1/check-maintenance-lock")).json();
  if (locked === true) throw new Error("the Board's site is in its daily maintenance window (check-maintenance-lock) - try again later");

  const elections = await (await api(site, "/wp-json/boe-api/v1/get-elections?all=true")).json();
  if (!Array.isArray(elections) || !elections.length) throw new Error("get-elections returned no elections");
  const current = elections[0];
  console.log(`Election: ${current.Name} (${current.ElectionId})`);

  const body = new URLSearchParams({
    exportMethod: "csv", ElectionId: String(current.ElectionId), Application: "", Exclude: "",
    RequestedStartDate: "", RequestedEndDate: "", pParty: "", OfficeCode: "", SortBy: "pn",
  });
  console.log("POST export-absentee-lists (the server takes about half a minute)");
  const t0 = Date.now();
  const exported = await (await api(site, "/wp-json/boe-api/v1/export-absentee-lists", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: base },
    body,
  })).json();
  if (!exported?.filename) throw new Error(`export-absentee-lists gave no filename: ${JSON.stringify(exported).slice(0, 200)}`);
  console.log(`  ${exported.count?.toLocaleString?.() ?? exported.count} rows in ${exported.filename} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  console.log(`GET download.php?file=${exported.filename}`);
  const res = await api(site, `/download.php?file=${encodeURIComponent(exported.filename)}`);
  const type = res.headers.get("content-type") ?? "";
  if (/text\/html/i.test(type)) throw new Error("download.php answered with a web page, not the CSV");
  const expected = Number(res.headers.get("content-length") ?? 0);
  const chunks = [];
  let got = 0, lastSaid = Date.now();
  for await (const chunk of res.body) {
    chunks.push(chunk); got += chunk.length;
    if (Date.now() - lastSaid > 5000) {
      console.log(`  ... ${(got / 1048576).toFixed(1)} MB${expected ? ` of ${(expected / 1048576).toFixed(1)}` : ""}`);
      lastSaid = Date.now();
    }
  }
  console.log(`  ${(got / 1048576).toFixed(1)} MB`);
  return Buffer.concat(chunks).toString("latin1");
}

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

// ------------------------------------------------------------- convert ---

const text = args.in
  ? (console.log(`Read ${args.in}`), readFileSync(resolve(args.in), "latin1"))
  : await download(args.site);

const rows = parseCsv(text.replace(/^﻿/, ""));
if (rows.length < 2) throw new Error("no data rows in the export");
// The header has "MiddleName" twice; keep the FIRST column of a repeated name.
const header = rows[0].map((h) => squash(h).toUpperCase());
const col = {};
header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
for (const need of ["VOTERID", "LASTNAME", "FIRSTNAME", "REQUEST APPLICATION DATE", "RETURN BALLOT DATE", "PRECINCTNAME", "VOTERPARTY"]) {
  if (!(need in col)) throw new Error(`no '${need}' column in: ${header.join(" | ")}`);
}
const get = (r, name) => squash(r[col[name]]);

const PARTY = { U: "", N: "", D: "DEM", R: "REP", L: "LIB", G: "GRE" };
/** "2026-10-24" -> "10/24/2026" (lib/absentee.mjs reads m/d/y). */
const mdy = (s) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : s; };

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];
const out = [HEADER.join(",")];
let returned = 0, inPerson = 0;
for (const r of rows.slice(1)) {
  const requested = get(r, "REQUEST APPLICATION DATE");
  const ret = get(r, "RETURN BALLOT DATE");
  const sameDay = ret !== "" && ret === requested;
  if (ret) returned++;
  if (sameDay) inPerson++;
  const cs = get(r, "CITYSTATE").match(/^(.*?)\s+([A-Z]{2})$/);
  const first = get(r, "FIRSTNAME").split(" ");
  const row = [
    get(r, "LASTNAME"), first[0] ?? "", first.slice(1).join(" "), get(r, "SUFFIXNAME"),
    PARTY[get(r, "VOTERPARTY").toUpperCase()] ?? get(r, "VOTERPARTY"),
    String(Number(get(r, "VOTERID"))),
    get(r, "ADDRESS1"), [get(r, "ADDRESS2"), get(r, "ADDRESS3")].filter(Boolean).join(" "),
    cs ? cs[1] : get(r, "CITYSTATE"), cs ? cs[2] : "", get(r, "ZIP").slice(0, 5), "",
    mdy(requested), mdy(ret),
    ret ? (sameDay ? "IN OFFICE" : "MAIL") : "NOT RECEIVED",
    sameDay ? "IN OFFICE" : "MAIL",
    get(r, "PRECINCTNAME"),
    mdy(requested),
    ret ? "VALID" : "",
  ];
  out.push([...row, sameDay ? "in-person" : "mail"].map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${(rows.length - 1).toLocaleString()} ballots, ${returned.toLocaleString()} returned (${inPerson.toLocaleString()} the day they were requested, read as early in-person)`);
console.log(`::notice title=Absentee data::Hamilton BOE export, ${rows.length - 1} ballots`);
