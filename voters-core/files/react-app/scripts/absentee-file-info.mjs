/**
 * Describe one Board of Elections absentee CSV as a line of JSON, so a
 * freshly downloaded copy can be compared with the one in SourceData/:
 *
 *   node scripts/absentee-file-info.mjs "../SourceData/TrumbullCounty_absentee 2026 general.csv"
 *   -> {"rows":18198,"voters":18078,"returned":9441,"latestDate":"2026-10-16","sha256":"..."}
 *
 * "latestDate" is the newest Issued or Returned date in the file, which is the
 * honest version stamp: the BOE regenerates the file daily and the newest
 * date moves with it. Used by .github/workflows/check-absentee.yml and handy
 * by hand. Reads both file shapes through scripts/lib/absentee.mjs.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readBallots, latestDate } from "./lib/absentee.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/absentee-file-info.mjs <absentee.csv>");
  process.exit(2);
}

const raw = readFileSync(path);
const { format, rowCount, ballots } = readBallots(raw.toString("utf8"));
if (rowCount === 0) {
  console.error(`${path}: no ballot rows found - not an absentee file?`);
  process.exit(1);
}
let returned = 0;
for (const b of ballots.values()) if (b.returned) returned++;

console.log(
  JSON.stringify({
    format,
    rows: rowCount,
    voters: ballots.size,
    returned,
    latestDate: latestDate(ballots),
    sha256: createHash("sha256").update(raw).digest("hex"),
  }),
);
