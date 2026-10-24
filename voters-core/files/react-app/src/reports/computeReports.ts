import type { Election, Voter } from "../types/voter";

/**
 * Every figure the Reports view shows, derived from the voters the current
 * search and filters allow.
 *
 * WHAT THESE NUMBERS ARE, AND ARE NOT
 *
 * Since October 2026 the file is the registration roll from the Ohio Secretary
 * of State's county voter file (active and confirmation status), so a turnout
 * figure here is a share of registered voters. Before that it held only people
 * who had voted at least once, and "turnout" was a share of the voters on file.
 * The basis line at the top of the reports says which population every share
 * is of, because the two differ by tens of thousands of people.
 *
 * A second caveat is structural rather than cosmetic. Anything of the form
 * "voted only in X" is a statement about the WINDOW, not about the voter. When
 * this app held six elections, 47% of 2024 general voters appeared to have
 * voted in nothing else; at seven that fell to 29.5%; at eleven it is 19.3%.
 * The people did not change - the file grew. Reports that count one-time voters
 * print the window alongside the number.
 *
 * Everything here is a pure function of (voters, elections) so the Reports view
 * can memoise on the filtered array and recompute only when the filters move.
 */

/** Bits set in a 31-bit membership mask. */
export function popcount(n: number): number {
  let c = 0;
  for (let m = n; m; m &= m - 1) c++;
  return c;
}

// ---------------------------------------------------------------- cascade ---

export interface CascadeRow {
  index: number;
  label: string;
  countyWide: boolean;
  /** Still being voted: the count is early and absentee ballots returned so far. */
  provisional: boolean;
  /** Voters in the current selection who turned out. */
  voters: number;
  /** Share of the largest election in the same selection, 0-1. */
  share: number;
  /** Share of the voters eligible for it in the current selection, 0-1. */
  ofEligible: number;
}

/**
 * Turnout per election, chronological. Chronological rather than ranked: the
 * point of this report is the shape of a four-year cycle - which elections the
 * county actually shows up for - and sorting by size would destroy it.
 */
export function cascade(voters: Voter[], elections: Election[]): CascadeRow[] {
  const n = elections.length;
  const hit = new Array<number>(n).fill(0);
  const elig = new Array<number>(n).fill(0);
  for (const v of voters) {
    for (let i = 0; i < n; i++) {
      const b = 1 << i;
      if (v.electionMask & b) hit[i]++;
      if (v.eligibleMask & b) elig[i]++;
    }
  }
  // An election in progress is open to everyone here, but its bit is only in
  // eligibleMask for the people who have voted, so the denominator would be
  // its own numerator. Everyone in the selection is the honest one.
  elections.forEach((e, i) => {
    if (e.provisional) elig[i] = voters.length;
  });
  const max = Math.max(1, ...hit);
  return elections.map((e, i) => ({
    index: i,
    label: e.label,
    countyWide: e.countyWide,
    provisional: e.provisional === true,
    voters: hit[i],
    share: hit[i] / max,
    ofEligible: elig[i] ? hit[i] / elig[i] : 0,
  }));
}

// -------------------------------------------------------------- retention ---

export interface RetentionCell {
  /** Voters who turned out for both the row election and the column one. */
  both: number;
  /** `both` as a share of the row election's own turnout, 0-1. */
  share: number;
}

export interface Retention {
  labels: string[];
  /** Turnout per election, the row denominators. */
  totals: number[];
  /** rows[i][j]: of the people who voted in i, how many also voted in j. */
  rows: RetentionCell[][];
}

/**
 * The co-occurrence matrix, in one pass. Asymmetric on purpose: 89% of August
 * 2023 voters also voted in the 2022 general, but only 64% of 2022 general
 * voters turned out that August. Which way you read it is the finding.
 */
export function retention(voters: Voter[], elections: Election[]): Retention {
  const n = elections.length;
  const totals = new Array<number>(n).fill(0);
  const both: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (const v of voters) {
    const m = v.electionMask;
    if (!m) continue;
    // Walk only the bits this voter actually has: most have two or three, so
    // this is far cheaper than the n^2 the matrix suggests.
    const set: number[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) set.push(i);
    for (const i of set) {
      totals[i]++;
      for (const j of set) both[i][j]++;
    }
  }
  return {
    labels: elections.map((e) => e.label),
    totals,
    rows: both.map((row, i) =>
      row.map((c) => ({ both: c, share: totals[i] ? c / totals[i] : 0 })),
    ),
  };
}

// --------------------------------------------------------------- profile ---

export interface Profile {
  /** byCount[k] = voters who turned out for exactly k elections, k = 0..n. */
  byCount: number[];
  /** Voted in every election they were eligible for. */
  everyEligible: number;
  /** Voted in exactly one. */
  exactlyOne: number;
  /** Voted in every election on file, eligibility ignored - the naive reading. */
  everyOnFile: number;
  /** Mean of (voted / eligible) across the selection, 0-1. */
  meanRate: number;
  generalsOnly: number;
  primariesOnly: number;
  bothKinds: number;
  specialsOnly: number;
  /** How many elections the window holds - the number that makes the rest mean anything. */
  window: number;
}

export function profile(voters: Voter[], elections: Election[]): Profile {
  const n = elections.length;
  const byCount = new Array<number>(n + 1).fill(0);
  let everyEligible = 0;
  let everyOnFile = 0;
  let sumVoted = 0;
  let sumEligible = 0;
  let generalsOnly = 0;
  let primariesOnly = 0;
  let bothKinds = 0;
  let specialsOnly = 0;

  let pMask = 0;
  let gMask = 0;
  let sMask = 0;
  // "Every election on file" is the finished ones: an election still being
  // voted cannot be missed yet, so it is left out of the naive reading too.
  let all = 0;
  elections.forEach((e, i) => {
    const b = 1 << i;
    if (!e.provisional) all |= b;
    if (e.season === "primary") pMask |= b;
    else if (e.season === "general") gMask |= b;
    else sMask |= b;
  });

  for (const v of voters) {
    const m = v.electionMask;
    const nv = popcount(m);
    const ne = popcount(v.eligibleMask);
    byCount[nv]++;
    sumVoted += nv;
    sumEligible += ne;
    if (ne > 0 && (m & v.eligibleMask) === v.eligibleMask) everyEligible++;
    if (all !== 0 && (m & all) === all) everyOnFile++;
    const p = (m & pMask) !== 0;
    const g = (m & gMask) !== 0;
    if (p && g) bothKinds++;
    else if (g) generalsOnly++;
    else if (p) primariesOnly++;
    else if (m & sMask) specialsOnly++;
  }
  return {
    byCount,
    everyEligible,
    exactlyOne: byCount[1] ?? 0,
    everyOnFile,
    meanRate: sumEligible ? sumVoted / sumEligible : 0,
    generalsOnly,
    primariesOnly,
    bothKinds,
    specialsOnly,
    window: n,
  };
}

// -------------------------------------------------------------- geography ---

export interface PlaceRow {
  name: string;
  onFile: number;
  /** Mean of (voted / eligible) for this place, 0-1. */
  meanRate: number;
  /** Voted in at least 80% of what they were eligible for. */
  faithful: number;
  /** Voted exactly once. */
  onceOnly: number;
}

/**
 * Participation by place. `min` drops places too small for a rate to mean
 * anything - a precinct of nine voters will always top or bottom any ranking,
 * and saying so is noise rather than a finding.
 */
export function geography(
  voters: Voter[],
  key: "jurisdiction" | "precinct" | "city",
  min = 100,
): PlaceRow[] {
  const acc = new Map<
    string,
    { n: number; voted: number; elig: number; faithful: number; once: number }
  >();
  for (const v of voters) {
    const k = v[key];
    let o = acc.get(k);
    if (!o) {
      o = { n: 0, voted: 0, elig: 0, faithful: 0, once: 0 };
      acc.set(k, o);
    }
    const nv = popcount(v.electionMask);
    const ne = popcount(v.eligibleMask);
    o.n++;
    o.voted += nv;
    o.elig += ne;
    if (ne > 0 && nv / ne >= 0.8) o.faithful++;
    if (nv === 1) o.once++;
  }
  return [...acc]
    .filter(([, o]) => o.n >= min)
    .map(([name, o]) => ({
      name,
      onFile: o.n,
      meanRate: o.elig ? o.voted / o.elig : 0,
      faithful: o.faithful,
      onceOnly: o.once,
    }))
    .sort((a, b) => b.meanRate - a.meanRate);
}

// ---------------------------------------------------------------- cohorts ---

export interface CohortRow {
  /** "1970s" for older decades, "2024" once registrations are worth a year each. */
  label: string;
  sort: number;
  onFile: number;
  meanRate: number;
}

/**
 * Participation by when the voter registered. Bucketed by decade until 2020 and
 * yearly after: the recent years are where the gradient is steep and where the
 * count of elections someone has had the chance to vote in changes fastest.
 */
export function cohorts(voters: Voter[], splitFrom = 2020): CohortRow[] {
  const acc = new Map<number, { label: string; n: number; v: number; e: number }>();
  for (const v of voters) {
    const y = Number(v.registered.slice(0, 4));
    if (!y) continue;
    const bucket = y >= splitFrom ? y : Math.floor(y / 10) * 10;
    let o = acc.get(bucket);
    if (!o) {
      o = { label: y >= splitFrom ? String(bucket) : `${bucket}s`, n: 0, v: 0, e: 0 };
      acc.set(bucket, o);
    }
    o.n++;
    o.v += popcount(v.electionMask);
    o.e += popcount(v.eligibleMask);
  }
  return [...acc]
    .map(([sort, o]) => ({
      label: o.label,
      sort,
      onFile: o.n,
      meanRate: o.e ? o.v / o.e : 0,
    }))
    .sort((a, b) => a.sort - b.sort);
}

export interface MonthRow {
  month: string;
  count: number;
}

/**
 * Registrations per month. These are registrations that later produced a vote -
 * anyone who registered and never turned out is not in this file at all - so
 * the shape is trustworthy and the level is not.
 */
export function registrationsByMonth(voters: Voter[], from = "2022-01"): MonthRow[] {
  const acc = new Map<string, number>();
  for (const v of voters) {
    const m = v.registered.slice(0, 7);
    if (m && m >= from) acc.set(m, (acc.get(m) ?? 0) + 1);
  }
  return [...acc]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, count]) => ({ month, count }));
}

// --------------------------------------------------------- address quality ---

export interface QualityRow {
  city: string;
  onFile: number;
  unplaced: number;
  rate: number;
}

/**
 * Where the geocoder is losing addresses, by mailing city. This is the
 * maintenance report: it is a ranked list of where to spend the next hour on
 * scripts/geocode-voters.mjs, and it moves when that script improves.
 */
export function addressQuality(voters: Voter[], min = 200): QualityRow[] {
  const acc = new Map<string, { n: number; u: number }>();
  for (const v of voters) {
    let o = acc.get(v.city);
    if (!o) {
      o = { n: 0, u: 0 };
      acc.set(v.city, o);
    }
    o.n++;
    if (v.lat == null) o.u++;
  }
  return [...acc]
    .filter(([, o]) => o.n >= min)
    .map(([city, o]) => ({
      city,
      onFile: o.n,
      unplaced: o.u,
      rate: o.n ? o.u / o.n : 0,
    }))
    .sort((a, b) => b.rate - a.rate);
}

// ------------------------------------------------------------ early voting ---

export interface EarlyDay {
  /** ISO date. */
  date: string;
  inPerson: number;
  mail: number;
  total: number;
  cumulative: number;
  /** Returned that day by party code ("D", "R", "--", ...). */
  byParty: Record<string, number>;
}

export interface EarlyPartyRow {
  party: string;
  issued: number;
  returned: number;
  inPerson: number;
  mailIssued: number;
  mailReturned: number;
  /** mailReturned / mailIssued, 0-1. */
  mailRate: number;
}

export interface EarlyPaceRow {
  name: string;
  /** Turnout in the baseline general, within this selection. */
  baseline: number;
  voted: number;
  out: number;
  /** voted / baseline, 0-1. */
  pace: number;
}

export interface EarlyProfile {
  voted: number;
  /** Voted in both of the last two finished generals. */
  bothGenerals: number;
  /** Voted in the most recent finished primary. */
  lastPrimary: number;
  /** On file (voted before) but sat out the baseline general. */
  skippedBaseline: number;
  /** No finished election on file - this is their first vote on file. */
  firstVote: number;
  /** byPrior[k] = early voters who had voted in exactly k finished elections. */
  byPrior: number[];
  labels: { baseline: string; previousGeneral: string; primary: string };
}

export interface EarlyVoting {
  election: Election;
  days: EarlyDay[];
  parties: EarlyPartyRow[];
  /** Party codes in the order the chart stacks them - biggest early vote first. */
  partyOrder: string[];
  /** Returned ballots by party, all days. */
  returnedByParty: Record<string, number>;
  pace: { jurisdictions: EarlyPaceRow[]; precincts: EarlyPaceRow[] };
  profile: EarlyProfile;
  issued: number;
  returned: number;
  out: number;
  /** Voters in the selection the report describes. */
  selection: number;
}

/**
 * The election in progress, from the merged absentee file. Everything here is
 * over the current selection, like the other reports. Returns null when no
 * provisional election is loaded.
 *
 * "Pace" compares early votes so far with the same voters' turnout in the most
 * recent finished general - the baseline the file gives us. It is not a
 * forecast: the denominator is who turned out last time, not who is
 * registered, and election day is still to come.
 */
export function earlyVoting(voters: Voter[], elections: Election[]): EarlyVoting | null {
  const liveIndex = elections.findIndex((e) => e.provisional);
  if (liveIndex === -1) return null;
  const election = elections[liveIndex];
  const liveBit = 1 << liveIndex;

  const finished = elections.map((e, i) => ({ e, i })).filter(({ e }) => !e.provisional);
  // The baseline is the last finished general of the SAME kind of year: an
  // even-year general against the previous even-year general, not against the
  // odd-year municipal general in between, which draws half the voters.
  const sameCycle = finished.filter(
    ({ e }) => e.season === "general" && e.year % 2 === election.year % 2,
  );
  const generals = sameCycle.length ? sameCycle : finished.filter(({ e }) => e.season === "general");
  const primaries = finished.filter(({ e }) => e.season === "primary");
  const baseline = generals[generals.length - 1];
  const previous = generals[generals.length - 2];
  const primary = primaries[primaries.length - 1];
  let finishedMask = 0;
  for (const { i } of finished) finishedMask |= 1 << i;

  // Daily curve.
  const byDay = new Map<string, EarlyDay>();
  // Parties.
  const byParty = new Map<string, EarlyPartyRow>();
  // Pace.
  const byPlace = {
    jurisdiction: new Map<string, EarlyPaceRow>(),
    precinct: new Map<string, EarlyPaceRow>(),
  };
  const prof: EarlyProfile = {
    voted: 0,
    bothGenerals: 0,
    lastPrimary: 0,
    skippedBaseline: 0,
    firstVote: 0,
    byPrior: new Array<number>(finished.length + 1).fill(0),
    labels: {
      baseline: baseline?.e.label ?? "",
      previousGeneral: previous?.e.label ?? "",
      primary: primary?.e.label ?? "",
    },
  };
  let issued = 0;
  let returned = 0;

  for (const v of voters) {
    const votedEarly = (v.electionMask & liveBit) !== 0;
    for (const key of ["jurisdiction", "precinct"] as const) {
      const name = v[key];
      let row = byPlace[key].get(name);
      if (!row) {
        row = { name, baseline: 0, voted: 0, out: 0, pace: 0 };
        byPlace[key].set(name, row);
      }
      if (baseline && v.electionMask & (1 << baseline.i)) row.baseline++;
      if (votedEarly) row.voted++;
      if (v.ballotStatus === "out") row.out++;
    }

    const b = v.ballot;
    if (!b) continue;
    issued++;
    const inPerson = b.category === "EV";
    let p = byParty.get(v.party);
    if (!p) {
      p = { party: v.party, issued: 0, returned: 0, inPerson: 0, mailIssued: 0, mailReturned: 0, mailRate: 0 };
      byParty.set(v.party, p);
    }
    p.issued++;
    if (inPerson) p.inPerson++;
    else p.mailIssued++;
    if (!b.returned) continue;

    returned++;
    p.returned++;
    if (!inPerson) p.mailReturned++;

    let d = byDay.get(b.returned);
    if (!d) {
      d = { date: b.returned, inPerson: 0, mail: 0, total: 0, cumulative: 0, byParty: {} };
      byDay.set(b.returned, d);
    }
    if (inPerson) d.inPerson++;
    else d.mail++;
    d.total++;
    d.byParty[v.party] = (d.byParty[v.party] ?? 0) + 1;

    prof.voted++;
    const prior = v.electionMask & finishedMask;
    prof.byPrior[popcount(prior)]++;
    if (prior === 0) prof.firstVote++;
    if (baseline && previous &&
        prior & (1 << baseline.i) && prior & (1 << previous.i)) prof.bothGenerals++;
    if (primary && prior & (1 << primary.i)) prof.lastPrimary++;
    if (baseline && prior !== 0 && !(prior & (1 << baseline.i))) prof.skippedBaseline++;
  }

  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cum = 0;
  for (const d of days) {
    cum += d.total;
    d.cumulative = cum;
  }
  for (const p of byParty.values()) p.mailRate = p.mailIssued ? p.mailReturned / p.mailIssued : 0;
  const parties = [...byParty.values()].sort((a, b) => b.issued - a.issued);
  const returnedByParty: Record<string, number> = {};
  for (const p of parties) returnedByParty[p.party] = p.returned;
  const partyOrder = [...parties].sort((a, b) => b.returned - a.returned).map((p) => p.party);

  const paceRows = (m: Map<string, EarlyPaceRow>, min: number) =>
    [...m.values()]
      .filter((r) => r.baseline >= min)
      .map((r) => ({ ...r, pace: r.baseline ? r.voted / r.baseline : 0 }))
      .sort((a, b) => b.pace - a.pace);

  return {
    election,
    days,
    parties,
    partyOrder,
    returnedByParty,
    pace: {
      jurisdictions: paceRows(byPlace.jurisdiction, 100),
      precincts: paceRows(byPlace.precinct, 150),
    },
    profile: prof,
    issued,
    returned,
    out: issued - returned,
    selection: voters.length,
  };
}
