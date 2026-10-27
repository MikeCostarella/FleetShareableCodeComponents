// Domain types for the {{COUNTY}} County Ohio Voters lookup.

/** One voter who cast a ballot in the 2026 primary. */
export interface Voter {
  /** Board of Elections voter ID. */
  id: number;
  /** Precinct code as printed on the BOE export, e.g. "WAR 2F.01". */
  precinct: string;
  /** Surname, upper-case as exported. */
  lastName: string;
  /** Given + middle name (may lead with a suffix, e.g. "JR WILLIAM G"). */
  firstName: string;
  street: string;
  /** Mailing city from the BOE export - the post office, not the boundary. */
  city: string;
  /**
   * Civil jurisdiction the voter's coordinate falls in, from
   * TrumbullCountyJurisdictions. NO_JURISDICTION when they could not be placed.
   */
  jurisdiction: string;
  state: string;
  zip: string;
  /** Registration date as ISO "YYYY-MM-DD" ("" when the export had none). */
  registered: string;
  /** Party code: "R", "D", "L", or "--" (unaffiliated). */
  party: string;
  /** Labels of the elections this voter cast a ballot in, oldest first. */
  elections: string[];
  /**
   * The same membership as a bitmask over VoterMeta.elections, so the filter
   * can test tens of thousands of voters with one AND instead of array work.
   */
  electionMask: number;
  /**
   * Which of those elections this voter could vote in at all. County-wide
   * elections are set for everyone; a jurisdiction-limited special is set only
   * for voters in its precincts. Not voting and not being on the ballot are
   * different things, and the app must never report the second as the first.
   */
  eligibleMask: number;
  /** Latitude, or null when the address could not be placed. */
  lat: number | null;
  /** Longitude, or null when the address could not be placed. */
  lon: number | null;
  /** Which geocoding tier placed this voter; see GEO_TIERS. 0 = not placed. */
  geo: number;
  /**
   * The voter's early / absentee ballot for the election in progress, when the
   * dataset carries a provisional election and they are in its file. null for
   * everyone else - including everyone, once the election is over and the
   * official export has replaced the absentee file.
   */
  ballot: Ballot | null;
  /** Derived from `ballot`: see BallotStatus. */
  ballotStatus: BallotStatus;
  /** Pre-lowered blob of the searchable fields; built once at load. */
  search: string;
}

/** One early or absentee ballot, from the Board of Elections' daily file. */
export interface Ballot {
  /** BOE category code: EV, A, N, CO, M, MO, TO. See BALLOT_CATEGORY_LABELS. */
  category: string;
  /** ISO date the ballot was issued (or the early vote cast). */
  issued: string;
  /** ISO date it came back, or "" while it is still out. */
  returned: string;
  /**
   * True when the absentee file is the only place this voter appears: their
   * name, address and precinct come from it (a mailing address, no
   * registration date) rather than from the roll.
   */
  fromAbsenteeFile: boolean;
  /**
   * A problem the Board has flagged on a RETURNED ballot, in its own words
   * ("NO VOTER SIGNATURE", "ID ENVELOPE CONTAINS INSUFFICIENT INFORMATION").
   * Most are curable until the post-election deadline, so the ballot still
   * counts as returned here; "" when there is none. Only the state platform's
   * file carries this.
   */
  issue: string;
}

/**
 * Where a voter stands in the election in progress. "voted" is a returned
 * ballot - the only state that is a vote. "out" is a ballot issued and not yet
 * back. "none" is everyone the absentee file does not mention, which during
 * early voting means "has not voted yet", not "did not vote".
 */
export type BallotStatus = "voted" | "out" | "none";

export const BALLOT_STATUS_ORDER: BallotStatus[] = ["voted", "out", "none"];

export const BALLOT_STATUS_LABELS: Record<BallotStatus, string> = {
  voted: "Voted early",
  out: "Ballot out",
  none: "No ballot yet",
};

/** One-line explanations, for hover text on the filter and the legend. */
export const BALLOT_STATUS_HELP: Record<BallotStatus, string> = {
  voted:
    "The ballot has come back to the Board of Elections, or was cast in person at the early-voting center. This is the only state that is a vote.",
  out: "A mail ballot was issued and has not been returned yet. It is not a vote until it comes back.",
  none: "No absentee or early ballot on file for this voter. During early voting that means they have not voted yet — not that they will not.",
};

export function ballotStatusHelp(s: string): string {
  return BALLOT_STATUS_HELP[s as BallotStatus] ?? "";
}

/** Swatch per status for the map's "colour by early voting" mode. */
export const BALLOT_STATUS_COLORS: Record<BallotStatus, string> = {
  voted: "#4caf7d",
  out: "#e0b040",
  none: "#55687a",
};

export function ballotStatusLabel(s: string): string {
  return BALLOT_STATUS_LABELS[s as BallotStatus] ?? s;
}

export function ballotStatusColor(s: string): string {
  return BALLOT_STATUS_COLORS[s as BallotStatus] ?? "#55687a";
}

/** Readings of the BOE's ballot category codes; the code itself is the fallback. */
export const BALLOT_CATEGORY_LABELS: Record<string, string> = {
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

export function ballotCategoryLabel(code: string): string {
  return BALLOT_CATEGORY_LABELS[code] ?? `Absentee (code ${code})`;
}

/**
 * Bucket for voters with no civil boundary. A real value in every list
 * (filter, table, CSV) rather than a blank, so nothing silently drops out of a
 * filter that is meant to cover the whole roll.
 *
 * It is deliberately NOT called "Not placed": almost all of these voters have
 * no coordinate, but one does and still lands outside all 39 boundaries, so
 * the honest label describes the missing jurisdiction, not the missing dot.
 */
export const NO_JURISDICTION = "No jurisdiction";

/**
 * How a voter's coordinate was found, mirroring the tiers in
 * scripts/geocode-voters.mjs. Shown in the voter dialog so the map never
 * implies more precision than the match actually justifies.
 */
export const GEO_TIERS: Record<number, string> = {
  0: "Not placed",
  1: "Address point (exact)",
  2: "Address point (quadrant differs)",
  3: "Address point (street type differs)",
  4: "Address point (filed under another city)",
  5: "Parcel record",
  6: "Address point (partial street name)",
};

/** True when this voter can be drawn on the map. */
export function isMapped(v: Voter): v is Voter & { lat: number; lon: number } {
  return v.lat != null && v.lon != null;
}

/** One election the dataset covers. Bit N of a voter's mask is elections[N]. */
export interface Election {
  id: string;
  label: string;
  year: number;
  season: string;
  /** Month, when the filename named one. Specials need it to sort. */
  month?: number | null;
  /** How many voters turned out, straight from that election's export. */
  voters: number;
  /** False for a ballot only part of the county could vote on. */
  countyWide: boolean;
  /** Precincts eligible to vote in it; null when county-wide. */
  scope: string[] | null;
  /**
   * True for an election still in progress, built from the Board's early and
   * absentee ballot file rather than a finished voter-history export. Its bit
   * is set only for RETURNED ballots, and it never counts against anyone:
   * a voter who has not voted yet is not a no-show.
   */
  provisional?: boolean;
  /** Latest date in the absentee file (provisional elections only). */
  asOf?: string;
  /** Election day, ISO (provisional elections only). */
  electionDate?: string | null;
  /** Ballots issued so far (provisional elections only). */
  issued?: number;
  /** Ballots returned so far - the same number as `voters` (provisional only). */
  returned?: number;
}

/** True for an election whose numbers are still moving. */
export function isProvisional(e: Election): boolean {
  return e.provisional === true;
}

/** Metadata that ships alongside the voter rows. */
export interface VoterMeta {
  county: string;
  runDate: string;
  count: number;
  /** Chronological, oldest first. */
  elections: Election[];
  /** Geocoding summary written by scripts/geocode-voters.mjs. */
  geocode?: { placed: number; unplaced: number; sources: string[] };
  /** Summary of the absentee file merged by scripts/convert-absentee.mjs. */
  absentee?: {
    sourceFile: string;
    asOf: string;
    rows: number;
    ballots: number;
    reissued: number;
    returned: number;
    byCategory: Record<string, number>;
    matchedExisting: number;
    added: number;
  };
}

/** How an election multi-select combines its selections. */
export type ElectionMatch = "any" | "all";

/** Human-readable party names keyed by the export's one-letter codes. */
export const PARTY_LABELS: Record<string, string> = {
  R: "Republican",
  D: "Democrat",
  L: "Libertarian",
  G: "Green",
  "--": "Unaffiliated",
};

/** Swatch color per party, used by the legend and the party pill. */
export const PARTY_COLORS: Record<string, string> = {
  R: "#e05a55",
  D: "#4a90d9",
  L: "#e0b040",
  G: "#4caf7d",
  "--": "#8ab4cc",
};

export function partyLabel(code: string): string {
  return PARTY_LABELS[code] ?? code;
}

export function partyColor(code: string): string {
  return PARTY_COLORS[code] ?? "#8ab4cc";
}

/** "LAST, FIRST MIDDLE" for display and export. */
export function fullName(v: Voter): string {
  return v.firstName ? `${v.lastName}, ${v.firstName}` : v.lastName;
}

/**
 * Split "3910 EAST RIVER RD SW" into its house number and street name, so the
 * list can sort the way an address list is actually read: street first, then up
 * the street numerically.
 *
 * A plain string sort puts every address beginning "1 " together - 1 Arms Blvd,
 * 1 Colliers Ct, 1 Diamond St - and scatters a single street across the whole
 * table, which is the opposite of useful for anything done door to door.
 *
 * Numbers are compared numerically, so 9 comes before 10 rather than after it.
 * A leading number with a suffix ("123-A", "123B") keeps its numeric part and
 * falls back to the raw string as a tiebreak. An address with no leading number
 * gets -1 and sorts before the numbered ones on that street.
 *
 * Half-addresses are real here and have to be handled, not tolerated: Trumbull
 * has "38 1/2 BANE AVE", "532 1/2 N CENTER ST" and dozens more. Read naively
 * the street name becomes "1/2 BANE AVE" and every half-address in the county
 * collects at the top of the list under "1". The fraction is folded into the
 * number instead, so 38 1/2 sorts between 38 and 39 where it belongs.
 *
 * Unit markers come out of the street name and become a tiebreak, because
 * leaving them in splits a building off its own street: 1,813 voters live at
 * "... # APT n" addresses, and Ridge Rd alone carries 45 distinct unit strings
 * that would each sort as a separate street after the plain ones. Units are
 * compared numerically too, so APT 2 precedes APT 10.
 *
 * Directionals are left exactly as written: "N MAIN ST" and "S MAIN ST" sort
 * apart, under N and S, because they are different streets and the BOE writes
 * them the way it writes them.
 */
interface StreetParts {
  /** Street name with the house number, any fraction and any unit removed. */
  name: string;
  /** House number; a half-address carries .5. -1 when there is no number. */
  number: number;
  /** "APT 106", "UNIT 210", "" - whatever followed the "#". */
  unit: string;
}

const streetPartsCache = new Map<string, StreetParts>();

export function streetParts(street: string): StreetParts {
  const cached = streetPartsCache.get(street);
  if (cached) return cached;
  const m = /^\s*(\d+)\S*\s+(.*)$/.exec(street);
  let rest = m ? m[2] : street;
  let number = m ? Number(m[1]) : -1;

  if (m) {
    const fraction = /^(\d+)\/(\d+)\s+(.*)$/.exec(rest);
    if (fraction) {
      number += Number(fraction[1]) / Number(fraction[2]);
      rest = fraction[3];
    }
  }

  const hash = rest.indexOf("#");
  const unit = hash === -1 ? "" : rest.slice(hash + 1).trim();
  const name = (hash === -1 ? rest : rest.slice(0, hash)).trim();

  const parts: StreetParts = { name, number, unit };
  streetPartsCache.set(street, parts);
  return parts;
}

/** Street name, then house number, then unit. Raw string breaks any last tie. */
export function compareStreets(a: string, b: string): number {
  const A = streetParts(a);
  const B = streetParts(b);
  return (
    A.name.localeCompare(B.name) ||
    A.number - B.number ||
    A.unit.localeCompare(B.unit, undefined, { numeric: true }) ||
    a.localeCompare(b, undefined, { numeric: true })
  );
}

/** Single-line mailing address for display and map links. */
export function fullAddress(v: Voter): string {
  return `${v.street}, ${v.city}, ${v.state} ${v.zip}`;
}

/** ISO "YYYY-MM-DD" -> "Mar 19, 2024"; passes anything unparseable through. */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Registration year, or null when the export had no date. */
export function registeredYear(v: Voter): number | null {
  const y = parseInt(v.registered.slice(0, 4), 10);
  return Number.isNaN(y) ? null : y;
}
