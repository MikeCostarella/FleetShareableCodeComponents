/**
 * Download a Board of Elections' VoterView "Absent Voter Details" report (the
 * Crystal Reports .xls some Boards post on their own website instead of using
 * the state platform - Morrow, Oct 2026) and write it to SourceData/ as a CSV
 * in the VoterView column layout that scripts/lib/absentee.mjs already reads,
 * so convert-absentee.mjs, absentee-file-info.mjs and the refresh task need no
 * changes. The twin of fetch-absentee-platform.mjs for these counties.
 *
 *   node scripts/fetch-absentee-voterview.mjs --url=<xls url> "--out=../SourceData/<County>County_absentee 2026 general.csv"
 *   node scripts/fetch-absentee-voterview.mjs --in=C:\Users\Mike\Downloads\morrow.xls --out=...   (a file already downloaded)
 *
 * The URL normally comes from react-app/absentee-source.json, which
 * refresh-absentee.ps1 reads to pick this fetcher over the platform one.
 *
 * THE REPORT
 * A formatted sheet: title rows, "Run Date:" / "Election:" rows, then one
 * header row ("Category/Org", "Issued", "AV ID", "Returned", "BT", "Party",
 * "Name", "Mailed To", "City", "Cons", "Precinct", "Stub #") and one data row
 * per ballot, blank rows between. Columns are found by header text, not
 * position. Dates are mm/dd/yy.
 *
 * THE CATCH: "AV ID" is the ballot application's number, NOT the county voter
 * ID the roll uses (Crystal Abdon is 19889 on the roll and 91006 here). So each
 * ballot is matched to the roll in public/data/voters.json by surname + first
 * name + house number, then surname + first name alone when that is unique.
 * The CSV carries the ROLL's id, which is what convert-absentee.mjs joins on.
 * A ballot that matches no one is written with id 9000000 + AV ID (far above
 * any county id) and becomes a "not yet on the roll" voter, like a voter the
 * platform file knows and the SoS file does not yet.
 *
 * Category codes (Category / Org in the report -> lib/absentee.mjs codes):
 *   EVOFF/OFF early in-person (EV) - REG/MAIL mail (A) - REG/HCO hand carried
 *   (HC) - NH nursing home (N) - OS-CI civilian overseas (CO) - OS-MI military
 *   overseas (MO) - MIL military (M) - org EM e-mail delivery (UE).
 * Party: NOPTY/REP/DEM/LIB -> -- / R / D / L (the roll's letters).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const OUT = args.out ? resolve(args.out) : null;
const ROLL = resolve(args.roll ?? join(APP, "public", "data", "voters.json"));
if (!OUT || !(args.url || args.in)) {
  console.error("usage: fetch-absentee-voterview.mjs (--url=<xls url> | --in=<xls file>) --out=<csv path> [--roll=<voters.json>]");
  process.exit(2);
}

// ------------------------------------------------------------- download ---

let bytes;
if (args.in) {
  bytes = readFileSync(resolve(args.in));
  console.log(`Read ${args.in} (${bytes.length.toLocaleString()} bytes)`);
} else {
  console.log(`GET ${args.url}`);
  const res = await fetch(args.url, {
    headers: { "User-Agent": "CountyVoters absentee refresh (github.com/MikeCostarella)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${args.url}`);
  bytes = Buffer.from(await res.arrayBuffer());
  console.log(`  ${bytes.length.toLocaleString()} bytes`);
}

// ------------------------------------------------------------- the sheet ---

const wb = XLSX.read(bytes, { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).map((r) => r.map((c) => String(c ?? "").trim()));

const head = rows.findIndex((r) => r.some((c) => /^Category\s*\/\s*Org$/i.test(c)));
if (head < 0) throw new Error("no 'Category/Org' header row - not a VoterView Absent Voter Details report?");
const H = rows[head];
const col = (label) => {
  const i = H.findIndex((c) => c.replace(/\s+/g, " ").toLowerCase() === label.toLowerCase());
  if (i < 0) throw new Error(`header '${label}' not found in: ${H.filter(Boolean).join(" | ")}`);
  return i;
};
const C = {
  cat: col("Category/Org"), issued: col("Issued"), avId: col("AV ID"), returned: col("Returned"),
  bt: col("BT"), party: col("Party"), name: col("Name"), mailTo: col("Mailed To"),
  city: col("City"), precinct: col("Precinct"), stub: col("Stub #"),
};
C.org = C.cat + 1;

const runDateRow = rows.find((r) => /^Run Date/i.test(r[0] ?? ""));
const runDate = runDateRow ? runDateRow.find((c, i) => i > 0 && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c)) ?? "" : "";
const electionRow = rows.find((r) => r.some((c) => /\bELECTION\b/i.test(c) && !/^Election:/i.test(c)));
const election = electionRow ? electionRow.find((c) => /\bELECTION\b/i.test(c)) : "";
console.log(`  report run ${runDate || "(no run date)"} - ${election || "(no election name)"}`);

// ------------------------------------------------------------- the roll ---

const roll = JSON.parse(readFileSync(ROLL, "utf8"));
const F = Object.fromEntries(roll.fields.map((f, i) => [f, i]));
const squash = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const houseNo = (street) => (squash(street).match(/^(\d+)\b/) ?? [, ""])[1];
const byNameNo = new Map(); // "LAST|FIRST|1234" -> [ids]
const byName = new Map();   // "LAST|FIRST"      -> [ids]
const precinctOf = new Map();
const zipOf = new Map();
for (const v of roll.voters) {
  const last = squash(v[F.lastName]);
  const first = squash(v[F.firstName]).split(" ")[0] ?? "";
  const k1 = `${last}|${first}|${houseNo(v[F.street])}`;
  const k2 = `${last}|${first}`;
  (byNameNo.get(k1) ?? byNameNo.set(k1, []).get(k1)).push(v[F.id]);
  (byName.get(k2) ?? byName.set(k2, []).get(k2)).push(v[F.id]);
  precinctOf.set(v[F.id], roll.precincts[v[F.precinct]] ?? "");
  zipOf.set(v[F.id], String(roll.zips[v[F.zip]] ?? ""));
}

// ------------------------------------------------------------- ballots ---

const CATEGORY = (cat, org) => {
  cat = cat.toUpperCase(); org = org.toUpperCase();
  if (cat === "NH") return "N";
  if (cat === "OS-CI") return "CO";
  if (cat === "OS-MI") return "MO";
  if (cat === "MIL") return "M";
  if (cat === "EVOFF" || org === "OFF") return "EV";
  if (org === "EM") return "UE";
  if (org === "HCO") return "HC";
  return "A";
};
const PARTY = { NOPTY: "--", NON: "--", REP: "R", DEM: "D", LIB: "L", GRN: "G" };
const mdy = (s) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${m[1]}/${m[2]}/${y}`;
};
const csv = (f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);

const resolved = []; // [r, id, csz]
let matchedNo = 0, matchedName = 0, unmatched = 0, ambiguous = 0;
for (const r of rows.slice(head + 1)) {
  const avId = r[C.avId];
  if (!/^\d+$/.test(avId)) continue;
  const nm = r[C.name].match(/^([^,]+),\s*(.*)$/);
  const last = squash(nm ? nm[1] : r[C.name]);
  const firstAll = squash(nm ? nm[2] : "");
  const first = firstAll.split(" ")[0] ?? "";
  const no = houseNo(r[C.mailTo]);
  const cityCell = r[C.city]; // "MARENGO OH 43334"
  const cm = cityCell.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
  const csz = cm ? `${cm[1]}, ${cm[2]} ${cm[3]}` : cityCell;
  const zip = cm ? cm[3] : "";
  let id = null;
  let hit = byNameNo.get(`${last}|${first}|${no}`);
  if (hit && hit.length === 1) { id = hit[0]; matchedNo++; }
  else {
    hit = byName.get(`${last}|${first}`) ?? [];
    // Several voters share the name (father and son): the one in the ballot's
    // ZIP, when that singles one out.
    if (hit.length > 1 && zip) hit = hit.filter((i) => zipOf.get(i) === zip);
    if (hit.length === 1) { id = hit[0]; matchedName++; }
    else if (hit.length > 1) ambiguous++;
  }
  if (id === null) { unmatched++; id = 9000000 + Number(avId); }
  resolved.push([r, id, csz]);
}
if (!resolved.length) throw new Error("no ballot rows found under the header");

// The report's precinct codes ("120084.BUV") -> the roll's precinct names,
// learned from the ballots that matched, so a voter not on the roll still gets
// a real precinct when the code is known.
const codeNames = new Map();
for (const [r, id] of resolved) {
  const name = precinctOf.get(id);
  if (!name) continue;
  const m = codeNames.get(r[C.precinct]) ?? new Map();
  m.set(name, (m.get(name) ?? 0) + 1);
  codeNames.set(r[C.precinct], m);
}
const precinctForCode = (code) => {
  const m = codeNames.get(code);
  if (!m) return code;
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

const out = [];
let returned = 0;
for (const [r, id, csz] of resolved) {
  const avId = r[C.avId];
  const nm = r[C.name].match(/^([^,]+),\s*(.*)$/);
  const last = squash(nm ? nm[1] : r[C.name]);
  const firstAll = squash(nm ? nm[2] : "");
  const precinct = precinctOf.get(id) || precinctForCode(r[C.precinct]);
  // Trumbull's VoterView CSV layout: lib/absentee.mjs reads cells 9-19.
  const row = [
    "voterview-xls", runDate, election, avId, r[C.stub], r[C.bt], r[C.cat], r[C.org], id >= 9000000 ? "not on roll" : "",
    "",                                   // 9  care-of (blank = normal row)
    `${firstAll} ${last}`.trim(),         // 10 name, FIRST MIDDLE LAST
    r[C.mailTo],                          // 11 mailed to
    csz,                                  // 12 CITY, ST 12345
    "",                                   // 13 country
    precinct,                             // 14 precinct
    PARTY[r[C.party].toUpperCase()] ?? r[C.party], // 15 party
    CATEGORY(r[C.cat], r[C.org]),         // 16 category
    mdy(r[C.issued]),                     // 17 issued
    mdy(r[C.returned]),                   // 18 returned
    String(id),                           // 19 voter id (the roll's)
    "",                                   // 20 state id
  ];
  if (row[18]) returned++;
  out.push(row.map(csv).join(","));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  ${out.length.toLocaleString()} ballots, ${returned.toLocaleString()} returned`);
console.log(`  matched to the roll: ${matchedNo.toLocaleString()} by name + house number, ${matchedName.toLocaleString()} by name alone; ` +
  `${unmatched.toLocaleString()} not on the roll (${ambiguous} of them a name shared by several voters)`);
console.log(`::notice title=Absentee data::VoterView report run ${runDate}, ${out.length} ballots`);
