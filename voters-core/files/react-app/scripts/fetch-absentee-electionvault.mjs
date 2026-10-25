/**
 * Download a Board of Elections' "Election Vault" absentee lists (Butler,
 * Oct 2026: two CSVs on electionlink.bcohio.gov - "Absentee by Mail Voter
 * List (Current Election)" and "Absentee In-Person Voter List (Current
 * Election)") and write them to SourceData/ as ONE CSV in the state platform's
 * column layout, which scripts/lib/absentee.mjs already reads. So
 * convert-absentee.mjs, absentee-file-info.mjs and the refresh task need no
 * changes - the third fetcher beside fetch-absentee-platform.mjs (the state
 * platform) and fetch-absentee-voterview.mjs (a VoterView .xls).
 *
 *   node scripts/fetch-absentee-electionvault.mjs --mail-url=<csv url> --inperson-url=<csv url> "--out=../SourceData/<County>County_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-electionvault.mjs --mail-in=<file> --inperson-in=<file> --out=...    (files already downloaded)
 *
 * The URLs normally come from react-app/absentee-source.json, which
 * refresh-absentee.ps1 reads to pick this fetcher.
 *
 * THE FILES
 * Real CSVs with a header row, Latin-1 encoded: Voter ID, First Name, Last
 * Name, Address, City, State, Zip, Precinct ("FAIR2WD3.0"), a dozen district
 * columns, Party (UNAFFILIATED / REPUBLICAN / ...), Requested Date, Ballot
 * Issued (in-person) or Ballot Mailed (mail), Ballot Returned, Type (mail
 * only: ABSENTEE BALLOT, NURSING HOME, FPCA CIVILIAN OVERSEAS, FPCA MILITARY
 * OVERSEAS, FPCA IN COUNTRY) and Challenge Code (mail only: VAL, IDNOMATCH,
 * SIGNOMATCH, NOSIG, NHR...). Columns are found by header text.
 *
 * Unlike Morrow's VoterView report, "Voter ID" IS the county voter ID the SoS
 * roll uses (24,570 of 24,581 in-person voters matched the roll by id with the
 * name agreeing on every one), so ballots join to the roll directly. An
 * in-person ballot is issued and returned the same day; a mail ballot with no
 * Ballot Returned date is still out.
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
const haveMail = args["mail-url"] || args["mail-in"];
const haveInPerson = args["inperson-url"] || args["inperson-in"];
if (!OUT || !haveMail || !haveInPerson) {
  console.error("usage: fetch-absentee-electionvault.mjs (--mail-url=<url> | --mail-in=<file>) (--inperson-url=<url> | --inperson-in=<file>) --out=<csv path>");
  process.exit(2);
}

// ------------------------------------------------------------- download ---

async function load(url, file, what) {
  if (file) {
    const text = readFileSync(resolve(file), "latin1");
    console.log(`Read ${what}: ${file} (${text.length.toLocaleString()} chars)`);
    return text;
  }
  console.log(`GET ${what}: ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": "CountyVoters absentee refresh (github.com/MikeCostarella)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
  console.log(`  ${text.length.toLocaleString()} chars`);
  return text;
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

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

/** Rows of one file as objects keyed by header, with the headers checked. */
function table(text, what, required) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error(`${what}: no data rows`);
  const header = rows[0].map((h) => squash(h).toUpperCase());
  for (const h of required) {
    if (!header.includes(h.toUpperCase())) throw new Error(`${what}: no '${h}' column in: ${header.join(" | ")}`);
  }
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, squash(r[i])])));
}

// ------------------------------------------------------------- mapping ---

const PARTY = { UNAFFILIATED: "", NON: "", REPUBLICAN: "REP", DEMOCRATIC: "DEM", LIBERTARIAN: "LIB", GREEN: "GRE" };
/** Election Vault mail "Type" -> the platform's AVAPPTYPE text (lib/absentee.mjs maps those to codes). */
const MAIL_TYPE = {
  "ABSENTEE BALLOT": "MAIL",
  "NURSING HOME": "NURSING HOME",
  "FPCA CIVILIAN OVERSEAS": "CIVILIAN OVERSEAS",
  "FPCA MILITARY OVERSEAS": "MILITARY OVERSEAS",
  "FPCA IN COUNTRY": "MILITARY",
};
/** Challenge codes -> the platform's AVBALSTAT wording (shown as the Board's flag). */
const CHALLENGE = {
  "": "", VAL: "VALID",
  IDNOMATCH: "ID DOES NOT MATCH", SIGNOMATCH: "SIGNATURE DOES NOT MATCH", NOSIG: "NO VOTER SIGNATURE",
  NHR: "NHR (BOARD CODE)",
};

const HEADER = ["LASTN", "FIRSTN", "MIDDLEN", "SUFFIXN", "PARTYAFFIL", "CNTYIDNUM", "AVADDR1", "AVADDR2", "CITY", "STATE",
  "ZIPCODE", "COUNTRY", "AVSENTDATE", "AVRECVDATE", "AVRECVMETH", "AVAPPTYPE", "PRECNAME", "AVAPPDATE", "AVBALSTAT", "SOURCE"];

function platformRow(r, { sent, appType, recvMeth, status }) {
  const returned = r["BALLOT RETURNED"] ?? "";
  return [
    r["LAST NAME"], r["FIRST NAME"], "", "",
    PARTY[(r["PARTY"] ?? "").toUpperCase()] ?? r["PARTY"],
    String(Number(r["VOTER ID"])),            // "000000030" -> "30", the roll's county id
    r["ADDRESS"], "", r["CITY"], r["STATE"], (r["ZIP"] ?? "").slice(0, 5), "",
    sent, returned,
    returned ? recvMeth : "NOT RECEIVED",
    appType,
    (r["PRECINCT"] ?? "").split(".")[0],       // "FAIR2WD3.0" -> "FAIR2WD3", the roll's spelling
    r["REQUESTED DATE"] ?? "",
    returned ? status : "",
  ];
}

// ------------------------------------------------------------- run ---

const [mailText, inPersonText] = await Promise.all([
  load(args["mail-url"], args["mail-in"], "by-mail list"),
  load(args["inperson-url"], args["inperson-in"], "in-person list"),
]);
const mail = table(mailText, "by-mail list", ["Voter ID", "Last Name", "Ballot Mailed", "Ballot Returned", "Type", "Challenge Code"]);
const inPerson = table(inPersonText, "in-person list", ["Voter ID", "Last Name", "Ballot Issued", "Ballot Returned"]);

const out = [HEADER.join(",")];
let returned = 0;
const seen = new Set();
let both = 0;
for (const r of inPerson) {
  const row = platformRow(r, { sent: r["BALLOT ISSUED"], appType: "IN OFFICE", recvMeth: "IN OFFICE", status: "VALID" });
  if (row[13]) returned++;
  seen.add(row[5]);
  out.push([...row, "in-person"].map(csv).join(","));
}
for (const r of mail) {
  const type = (r["TYPE"] ?? "").toUpperCase();
  const code = (r["CHALLENGE CODE"] ?? "").toUpperCase();
  const row = platformRow(r, {
    sent: r["BALLOT MAILED"], appType: MAIL_TYPE[type] ?? type, recvMeth: "MAIL",
    status: CHALLENGE[code] ?? code,
  });
  if (row[13]) returned++;
  if (seen.has(row[5])) both++;
  out.push([...row, "mail"].map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${(inPerson.length + mail.length).toLocaleString()} ballots (${inPerson.length.toLocaleString()} in person, ${mail.length.toLocaleString()} by mail), ${returned.toLocaleString()} returned` +
  (both ? `; ${both} voters in both lists (latest issue wins in the merge)` : ""));
console.log(`::notice title=Absentee data::Election Vault lists, ${inPerson.length + mail.length} ballots`);
