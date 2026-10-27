/**
 * Reading a county Board of Elections absentee / early-voting file, in either
 * of the two shapes Ohio counties publish. Shared by convert-absentee.mjs,
 * absentee-file-info.mjs and the refresh workflow, so the three agree on what
 * a ballot, a voter and "returned" mean.
 *
 * THE TWO FORMATS
 *
 * 1. VoterView export (Trumbull, Morrow). A formatted report, not a table:
 *    every row repeats the column headings in its first nine cells, the
 *    right-hand "Total:" column repeats the row count, and the columns shift
 *    by one on a care-of row. Detected by the ABSENCE of a header row -
 *    the first row's cells are not column names.
 *
 * 2. The state platform (lookup.boe.ohio.gov/vtrapp/<county>/avreport.aspx,
 *    "Downloadable File (Comma Separated Values)"), used by ~71 counties
 *    including Mahoning. A proper table with a header row:
 *
 *      LASTN, FIRSTN, MIDDLEN, PREFIXN, SUFFIXN, PARTYAFFIL, CNTYIDNUM,
 *      AVADDR1, AVADDR2, CITY, STATE, ZIPCODE, COUNTRY, AVSENTDATE,
 *      AVSENTMETH, AVRECVDATE, AVRECVMETH, AVAPPTYPE, AVAPPCODE, PRSID,
 *      PRECNAME, AVAPPDATE, AVAPPNUM, CURRENTPTYAFFIL, AVBALSTAT, SOSID
 *
 *    One row per voter (the platform collapses reissues itself). CNTYIDNUM is
 *    the county voter ID - the same number the SoS file calls COUNTY_ID and
 *    the app uses as the voter's id - and SOSID is the statewide one. Blank
 *    dates are written "/  /". AVRECVMETH says how a ballot came back (CAST
 *    IN PERSON, MAILED, DROP BOX, O T C/ PERSONAL DELIVERY) or that it has
 *    not (NOT RECEIVED), or that it cannot count (UNDELIVERABLE, REFUSED).
 *    AVBALSTAT is VALID, blank while the ballot is out, or a reason the
 *    ballot has a problem (NO VOTER SIGNATURE, ID ENVELOPE CONTAINS
 *    INSUFFICIENT INFORMATION, ...) - most of those are curable until the
 *    post-election deadline, so such a ballot is RETURNED but flagged.
 *
 * WHAT "RETURNED" MEANS
 *
 * A returned ballot is the only thing the app counts as a vote. In format 1
 * that is a non-blank Returned date. In format 2 it is a received date whose
 * receive method is an actual return - not NOT RECEIVED, UNDELIVERABLE or
 * REFUSED - and whose status is not REFUSED TO VOTE. A returned ballot with
 * a problem status keeps its date and carries the status as `issue`, so the
 * app can say "returned - no voter signature" rather than either hiding the
 * ballot or pretending it is fine.
 *
 * CATEGORIES
 *
 * Format 1 uses the BOE's own codes (EV, A, N, CO, M, MO, TO). Format 2's
 * application types are mapped onto those where they mean the same thing
 * (IN OFFICE -> EV, MAIL -> A, NURSING HOME -> N) and given new codes where
 * they do not (CB curbside, UE / UM UOCAVA by e-mail / mail, PA problem
 * application, HC hand carry, AB accessible ballot). BALLOT_CATEGORIES is the
 * single list of codes and readings; src/types/voter.ts carries the same
 * list for the UI.
 */
import { readFileSync } from "node:fs";

/** Ballot category codes with a reading of each. Both formats end up here. */
export const BALLOT_CATEGORIES = {
  EV: "Early in-person",
  A: "Absentee by mail",
  N: "Nursing home / care facility",
  CB: "Curbside (early in-person)",
  CO: "Civilian overseas",
  M: "Military",
  MO: "Military overseas",
  UE: "UOCAVA (military / overseas) by e-mail",
  UM: "UOCAVA (military / overseas) by mail",
  PA: "Problem application",
  HC: "Hand carried",
  AB: "Accessible ballot",
  JL: "Confined to a jail",
  HO: "Hospitalized",
  TO: "Absentee (code TO)",
};

/** Platform AVAPPTYPE -> category code. Anything unlisted keeps its own text. */
const PLATFORM_APP_TYPES = {
  "MAIL": "A",
  "IN OFFICE": "EV",
  "NURSING HOME": "N",
  "CURBSIDE": "CB",
  "UOCAVA EMAIL": "UE",
  "UOCAVA MAIL": "UM",
  "PROBLEM APP": "PA",
  "HAND CARRY": "HC",
  "ACCESSIBLE BALLOT": "AB",
  // Seen on the platform from Lorain (Oct 2026): a ballot delivered to a jail
  // or a hospital after the mail deadline.
  "JAIL": "JL",
  "HOSPITAL": "HO",
  // Written by fetch-absentee-electionvault.mjs (Butler's Election Vault
  // distinguishes these; the platform itself folds them into UOCAVA).
  "CIVILIAN OVERSEAS": "CO",
  "MILITARY": "M",
  "MILITARY OVERSEAS": "MO",
};

/** Platform party strings -> the roll's one-letter codes ("--" = none). */
const PLATFORM_PARTIES = { DEM: "D", REP: "R", LIB: "L", GRE: "G", CON: "C", SOC: "S" };

/** Receive methods that are NOT a ballot coming back. */
const NOT_A_RETURN = new Set(["NOT RECEIVED", "UNDELIVERABLE", "REFUSED", ""]);

export const squash = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** "10/16/2026" -> "2026-10-16" ("" when blank, "/  /" or unparseable). */
export function isoDate(s) {
  const m = squash(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** RFC-4180 CSV parser: quoted fields, doubled quotes, CRLF. Blank rows dropped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
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

/** Which of the two shapes this is, from the first row. */
export function detectFormat(rows) {
  const first = (rows[0] ?? []).map(squash);
  if (first.includes("CNTYIDNUM") && first.includes("AVAPPTYPE")) return "platform";
  return "voterview";
}

/**
 * Read an absentee file into one record per voter.
 *
 * Returns { format, rowCount, skipped, reissued, ballots } where ballots is a
 * Map from the county voter ID (number) to
 *
 *   { name, lastName, firstName, careOf, mailTo, csz, country, precinct,
 *     party, category, issued, returned, issue }
 *
 * `name` is the single "FIRST MIDDLE LAST" string the VoterView export gives
 * (format 2 fills it from the parts, and also gives lastName / firstName
 * directly, which are better). `issued` and `returned` are ISO dates or "".
 * `issue` is "" or the platform's problem status for a returned ballot.
 */
export function readBallots(text) {
  const rows = parseCsv(String(text).replace(/^﻿/, ""));
  const format = detectFormat(rows);
  return format === "platform" ? readPlatform(rows) : readVoterView(rows);
}

/** Convenience: readBallots over a file. */
export function readBallotsFile(path) {
  return readBallots(readFileSync(path, "utf8"));
}

// ----------------------------------------------------------- VoterView ---

function readVoterView(rows) {
  const ballots = new Map();
  let rowCount = 0;
  let reissued = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = squash(r[19]);
    if (!/^\d+$/.test(id)) { skipped++; continue; }
    rowCount++;
    // The columns shift by one when a ballot was mailed in care of someone:
    // cell 9 is normally blank and cell 10 the voter's name, but on a care-of
    // row cell 9 is the voter and cell 10 the care-of line.
    const careOfRow = squash(r[9]) !== "";
    const rec = {
      name: careOfRow ? squash(r[9]) : squash(r[10]),
      lastName: "",
      firstName: "",
      careOf: careOfRow ? squash(r[10]) : "",
      mailTo: squash(r[11]),
      csz: squash(r[12]),
      country: squash(r[13]),
      precinct: squash(r[14]),
      party: squash(r[15]) || "--",
      category: squash(r[16]).toUpperCase(),
      issued: isoDate(r[17]),
      returned: isoDate(r[18]),
      issue: "",
    };
    const vid = Number(id);
    const prev = ballots.get(vid);
    if (!prev) { ballots.set(vid, rec); continue; }
    // A reissued ballot (corrected care-of address, spoiled ballot) shows up
    // twice. Latest issue wins for the descriptive fields; a return on either
    // counts.
    reissued++;
    const keep = rec.issued >= prev.issued ? rec : prev;
    keep.returned = rec.returned || prev.returned;
    ballots.set(vid, keep);
  }
  return { format: "voterview", rowCount, skipped, reissued, ballots };
}

// ------------------------------------------------------------ platform ---

function readPlatform(rows) {
  const header = rows[0].map(squash);
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Platform absentee file has no "${name}" column`);
    return i;
  };
  const C = {
    last: col("LASTN"), first: col("FIRSTN"), middle: col("MIDDLEN"), suffix: col("SUFFIXN"),
    party: col("PARTYAFFIL"), id: col("CNTYIDNUM"),
    addr1: col("AVADDR1"), addr2: col("AVADDR2"), city: col("CITY"), state: col("STATE"),
    zip: col("ZIPCODE"), country: col("COUNTRY"),
    sent: col("AVSENTDATE"), recv: col("AVRECVDATE"), recvMeth: col("AVRECVMETH"),
    appType: col("AVAPPTYPE"), precinct: col("PRECNAME"), appDate: col("AVAPPDATE"),
    status: col("AVBALSTAT"),
  };

  const ballots = new Map();
  let rowCount = 0;
  let reissued = 0;
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = squash(r[C.id]);
    if (!/^\d+$/.test(id) || r.length < header.length) { skipped++; continue; }
    rowCount++;

    const last = squash(r[C.last]);
    const first = squash(r[C.first]);
    const middle = squash(r[C.middle]);
    const suffix = squash(r[C.suffix]);
    // The roll's convention: suffix leads the given names ("JR WILLIAM G").
    const firstName = [suffix, first, middle].filter(Boolean).join(" ");

    const addr2 = squash(r[C.addr2]);
    const mailTo = squash(r[C.addr1]) + (addr2 ? ` # ${addr2}` : "");
    const city = squash(r[C.city]);
    const state = squash(r[C.state]).toUpperCase();
    const zip = squash(r[C.zip]).slice(0, 5);
    const country = squash(r[C.country]);
    // The same "CITY, ST 12345" shape the VoterView export carries, so the
    // merge's address handling is one code path.
    const csz = city || state || zip ? `${city}, ${state} ${zip}`.replace(/\s+/g, " ").trim() : "";

    const recvMeth = squash(r[C.recvMeth]).toUpperCase();
    const status = squash(r[C.status]).toUpperCase();
    const recvDate = isoDate(r[C.recv]);
    const cameBack = recvDate !== "" && !NOT_A_RETURN.has(recvMeth) && status !== "REFUSED TO VOTE";
    const returned = cameBack ? recvDate : "";
    const issue = cameBack && status !== "VALID" && status !== "" ? status : "";

    const appType = squash(r[C.appType]).toUpperCase();
    const partyRaw = squash(r[C.party]).toUpperCase();

    if (ballots.has(Number(id))) reissued++; // same voter twice (not seen on the platform; Board exports that list reissues are collapsed by their converter)
    ballots.set(Number(id), {
      name: [first, middle, last, suffix].filter(Boolean).join(" "),
      lastName: last,
      firstName,
      careOf: "",
      mailTo,
      csz,
      country,
      precinct: squash(r[C.precinct]),
      party: PLATFORM_PARTIES[partyRaw] ?? "--",
      category: PLATFORM_APP_TYPES[appType] ?? appType,
      // The sent date; an application on file with no ballot sent yet has
      // none, and the app shows it as "ballot out" with no issue date.
      issued: isoDate(r[C.sent]),
      returned,
      issue,
    });
  }
  return { format: "platform", rowCount, skipped, reissued, ballots };
}

/**
 * Newest issued or returned date across the ballots - the file's honest version
 * stamp. Dates after today are ignored: Summit's Oct 2026 file carried 32 ballots
 * "sent" on 10/26/2029 (a Board typo), which would otherwise have been the stamp
 * for three years - and made every corrected file look older than the one on file.
 */
export function latestDate(ballots) {
  const today = new Date().toISOString().slice(0, 10);
  let asOf = "";
  for (const b of ballots.values()) {
    for (const d of [b.issued, b.returned]) {
      if (d && d <= today && d > asOf) asOf = d;
    }
  }
  return asOf;
}
