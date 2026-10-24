import type { Ballot, BallotStatus, Election, Voter, VoterMeta } from "../types/voter";
import { ballotStatusLabel, NO_JURISDICTION } from "../types/voter";

/** An option value paired with how many voters carry it. */
export interface NamedCount {
  name: string;
  count: number;
}

/**
 * On-disk shape of public/data/voters.json. The rows are tuples with the
 * repeated string fields (precinct / city / zip / party) replaced by indexes
 * into lookup tables — that keeps 31k records to ~2.3 MB instead of ~5 MB.
 */
interface RawVoterFile extends VoterMeta {
  precincts: string[];
  cities: string[];
  zips: string[];
  parties: string[];
  voters: [
    number, // id
    number, // precinct index
    string, // last name
    string, // first + middle
    string, // street
    number, // city index
    number, // zip index
    string, // registered (ISO)
    number, // party index
    number, // elections bitmask, bit N = meta.elections[N]
    number | null, // latitude  (null when not placed)
    number | null, // longitude
    number, // geocode tier, see GEO_TIERS
    number, // index into `jurisdictions`, or -1 when not placed
    // Optional 15th cell, present only while a provisional election is merged
    // in: 0, or [ballot category index, issued ISO, returned ISO or "", a 1
    // when the absentee file is this voter's only source (else 0), and an
    // optional problem status the Board flagged on a returned ballot].
    (0 | [number, string, string] | [number, string, string, 0 | 1] | [number, string, string, 0 | 1, string])?,
    // Optional 16th cell: index into `statuses` (ACTIVE / CONFIRMATION / UNKNOWN).
    number?,
  ][];
  jurisdictions: string[];
  elections: Election[];
  geocode?: { placed: number; unplaced: number; sources: string[] };
  /** Ballot category codes the `ballot` cell indexes into. */
  ballotCategories?: string[];
  absentee?: VoterMeta["absentee"];
}

export interface VoterDataset {
  meta: VoterMeta;
  voters: Voter[];
}

/** Fetch and expand the bundled dataset. Called once, on mount. */
export async function loadVoters(): Promise<VoterDataset> {
  const url = `${import.meta.env.BASE_URL}data/voters.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load voter data (HTTP ${res.status}).`);
  }
  const raw = (await res.json()) as RawVoterFile;

  const electionLabels = raw.elections.map((e) => e.label);
  const ballotCategories = raw.ballotCategories ?? [];

  /**
   * Eligibility depends only on precinct, and 43k voters share 189 of them, so
   * work it out once per precinct rather than once per voter.
   *
   * A provisional election - one still being voted - is left out on purpose.
   * Its bit is set for the voters whose ballot has come back, and `| mask`
   * below credits them; everyone else is "not voted yet", and must not be
   * counted as a no-show by "all", the history panel or the reports.
   */
  const eligibleByPrecinct = new Map<string, number>();
  const eligibleFor = (precinct: string): number => {
    const cached = eligibleByPrecinct.get(precinct);
    if (cached !== undefined) return cached;
    let mask = 0;
    raw.elections.forEach((e, i) => {
      if (e.provisional) return;
      // countyWide !== false so a dataset written before scopes existed still
      // treats every election as open to everyone.
      if (e.countyWide !== false || (e.scope?.includes(precinct) ?? false)) {
        mask |= 1 << i;
      }
    });
    eligibleByPrecinct.set(precinct, mask);
    return mask;
  };

  const voters: Voter[] = raw.voters.map((r) => {
    const mask = r[9] ?? 0;
    // Expanded once here so the table and dialog can render labels directly;
    // the mask is what the filter actually reads.
    const elections = electionLabels.filter((_, i) => (mask & (1 << i)) !== 0);
    const precinct = raw.precincts[r[1]] ?? "";
    // A voter added from the absentee file with an out-of-state mailing
    // address carries it as "FAIRMONT, WV"; everyone else is in Ohio.
    const cityRaw = raw.cities[r[5]] ?? "";
    const cityState = /^(.*), ([A-Z]{2})$/.exec(cityRaw);
    const city = cityState ? cityState[1] : cityRaw;
    const state = cityState ? cityState[2] : "OH";
    const zip = raw.zips[r[6]] ?? "";
    const party = raw.parties[r[8]] ?? "--";
    const jurisdiction =
      r[13] >= 0 ? (raw.jurisdictions[r[13]] ?? NO_JURISDICTION) : NO_JURISDICTION;
    const b = r[14];
    const ballot: Ballot | null = b
      ? {
          category: ballotCategories[b[0]] ?? "?",
          issued: b[1],
          returned: b[2],
          fromAbsenteeFile: b[3] === 1,
          issue: b[4] ?? "",
        }
      : null;
    const ballotStatus: BallotStatus = !ballot ? "none" : ballot.returned ? "voted" : "out";
    return {
      id: r[0],
      precinct,
      lastName: r[2],
      firstName: r[3],
      street: r[4],
      city,
      state,
      zip,
      registered: r[7],
      party,
      jurisdiction,
      elections,
      electionMask: mask,
      // Scope is derived from turnout, so a voter who has moved since can sit
      // outside the scope of an election they demonstrably voted in. Having
      // voted is proof of eligibility, so it always wins over the precinct
      // test - otherwise the dialog reports "voted in 4 of 3 elections".
      eligibleMask: eligibleFor(precinct) | mask,
      lat: r[10] ?? null,
      lon: r[11] ?? null,
      geo: r[12] ?? 0,
      ballot,
      ballotStatus,
      // One lowered blob so free-text search is a single indexOf per row.
      search:
        `${r[2]} ${r[3]} ${r[0]} ${r[4]} ${city} ${zip} ${precinct} ${jurisdiction}`.toLowerCase(),
    };
  });

  const meta: VoterMeta = {
    county: raw.county,
    runDate: raw.runDate,
    count: raw.count,
    elections: raw.elections,
    geocode: raw.geocode,
    absentee: raw.absentee,
  };

  return { meta, voters };
}

/** Distinct values of one field with counts, sorted for display. */
export function countBy(
  voters: Voter[],
  pick: (v: Voter) => string,
  sort: "name" | "count" = "name",
): NamedCount[] {
  const tally = new Map<string, number>();
  for (const v of voters) {
    const k = pick(v);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const out = [...tally].map(([name, count]) => ({ name, count }));
  out.sort((a, b) =>
    sort === "count" ? b.count - a.count || a.name.localeCompare(b.name)
                     : a.name.localeCompare(b.name),
  );
  return out;
}

/**
 * Build a CSV of the given voters, ready for download. When the dataset holds
 * a provisional election, four ballot columns follow the election columns so
 * the sheet can separate "voted early" from "ballot still out".
 */
export function toCsv(
  voters: Voter[],
  electionLabels: string[] = [],
  withBallots = false,
): string {
  const head = [
    "Voter ID", "Last Name", "First Name", "Precinct", "Street", "City",
    "State", "ZIP", "Jurisdiction", "Registered", "Party",
    // One Y/N column per election, so the sheet can be pivoted on turnout.
    ...electionLabels,
    "Elections Voted",
    ...(withBallots
      ? ["Early Voting", "Ballot Category", "Ballot Issued", "Ballot Returned"]
      : []),
    "Latitude", "Longitude",
  ];
  const esc = (s: string | number) => {
    const t = String(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [head.join(",")];
  for (const v of voters) {
    lines.push(
      [v.id, v.lastName, v.firstName, v.precinct, v.street, v.city, v.state,
       v.zip, v.jurisdiction, v.registered, v.party,
       ...electionLabels.map((label) => (v.elections.includes(label) ? "Y" : "N")),
       v.elections.length,
       ...(withBallots
         ? [
             ballotStatusLabel(v.ballotStatus),
             v.ballot?.category ?? "",
             v.ballot?.issued ?? "",
             v.ballot?.returned ?? "",
           ]
         : []),
       v.lat ?? "", v.lon ?? ""].map(esc).join(","),
    );
  }
  return lines.join("\r\n");
}
