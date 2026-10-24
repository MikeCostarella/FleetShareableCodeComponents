import { useMemo, useState } from "react";
import type { Election, Voter } from "../types/voter";
import { formatDate, NO_JURISDICTION, partyColor, partyLabel } from "../types/voter";
import {
  addressQuality,
  cascade,
  cohorts,
  earlyVoting,
  geography,
  popcount,
  profile,
  registrationsByMonth,
  retention,
} from "./computeReports";
import { BarList, HeatGrid, LineChart, RankTable, StatTile } from "./Charts";
import type { BarDatum, HeatCell, RankRow } from "./Charts";

export type ReportId =
  | "turnout"
  | "early"
  | "retention"
  | "participation"
  | "geography"
  | "registration";

const SECTIONS: { id: ReportId; label: string }[] = [
  { id: "turnout", label: "Turnout" },
  { id: "early", label: "Early voting" },
  { id: "retention", label: "Retention" },
  { id: "participation", label: "Participation" },
  { id: "geography", label: "Geography" },
  { id: "registration", label: "Registration & data" },
];

interface ReportsViewProps {
  /** The voters the current search and filters allow. Reports describe these. */
  voters: Voter[];
  /** Everyone, for the "of N" denominator in the caption. */
  totalVoters: number;
  elections: Election[];
  /** Human summary of what is filtering, or "" when nothing is. */
  filterSummary: string;
  onClearFilters: () => void;
  /** Hand the reader the voters behind a number, in the list view. */
  onDrill: (label: string, predicate: (v: Voter) => boolean) => void;
  onExportCsv: (
    filename: string,
    header: string[],
    rows: (string | number)[][],
  ) => void;
}

const pct = (f: number) => `${(f * 100).toFixed(f >= 0.995 || f === 0 ? 0 : 1)}%`;
const pct0 = (f: number) => `${Math.round(f * 100)}%`;
const num = (n: number) => n.toLocaleString();

/**
 * The Reports view.
 *
 * Reports describe the CURRENT selection, not the county, so "the retention
 * grid for Liberty Township" is just the jurisdiction filter plus this view.
 * The caption always names what is applied, because a filtered report that
 * looks county-wide is the single most dangerous thing this screen could do.
 */
export default function ReportsView({
  voters,
  totalVoters,
  elections,
  filterSummary,
  onClearFilters,
  onDrill,
  onExportCsv,
}: ReportsViewProps) {
  const [section, setSection] = useState<ReportId>("turnout");
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [placeKey, setPlaceKey] = useState<"jurisdiction" | "precinct">(
    "jurisdiction",
  );

  const casc = useMemo(() => cascade(voters, elections), [voters, elections]);
  /** null unless an election in progress is loaded; its tab is hidden then. */
  const early = useMemo(() => earlyVoting(voters, elections), [voters, elections]);
  const [pacePlace, setPacePlace] = useState<"jurisdiction" | "precinct">("jurisdiction");
  const [showAllPace, setShowAllPace] = useState(false);
  const sections = early ? SECTIONS : SECTIONS.filter((s) => s.id !== "early");
  const ret = useMemo(
    () => (section === "retention" ? retention(voters, elections) : null),
    [voters, elections, section],
  );
  const prof = useMemo(() => profile(voters, elections), [voters, elections]);
  const places = useMemo(
    () =>
      section === "geography"
        ? geography(voters, placeKey, placeKey === "precinct" ? 150 : 100)
        : [],
    [voters, placeKey, section],
  );
  const cohortRows = useMemo(
    () => (section === "registration" ? cohorts(voters) : []),
    [voters, section],
  );
  const months = useMemo(
    () => (section === "registration" ? registrationsByMonth(voters) : []),
    [voters, section],
  );
  const quality = useMemo(
    () => (section === "registration" ? addressQuality(voters) : []),
    [voters, section],
  );

  if (voters.length === 0) {
    return (
      <div id="reports-view">
        <div className="reports-empty">
          No voters match the current search and filters, so there is nothing to
          report on.{" "}
          {filterSummary && (
            <button type="button" className="link-btn" onClick={onClearFilters}>
              Clear the filters
            </button>
          )}
        </div>
      </div>
    );
  }

  const scopeNote = filterSummary ? (
    <>
      <b>{num(voters.length)}</b> of {num(totalVoters)} voters — {filterSummary}.{" "}
      <button type="button" className="link-btn" onClick={onClearFilters}>
        Clear
      </button>
    </>
  ) : (
    <>
      All <b>{num(voters.length)}</b> registered voters.
    </>
  );

  return (
    <div id="reports-view">
      <div className="reports-bar">
        <div className="reports-tabs" role="tablist" aria-label="Reports">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              className={`reports-tab${section === s.id ? " active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="reports-scope">{scopeNote}</div>
      </div>

      <div className="reports-body">
        {/* Said once, at the top, on every report: what the shares are of. */}
        <p className="reports-basis">
          Every figure here counts <b>registered voters</b> — the roll as the
          Ohio Secretary of State publishes it, active and confirmation-status
          voters alike, narrowed by whatever filters are set. A turnout share is
          votes cast over that registration, not over people who turned out at
          least once.
        </p>

        {section === "turnout" && (
          <TurnoutReport
            rows={casc}
            elections={elections}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
        {section === "early" && early && (
          <EarlyVotingReport
            ev={early}
            elections={elections}
            placeKey={pacePlace}
            onPlaceKey={setPacePlace}
            showAll={showAllPace}
            onShowAll={setShowAllPace}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
        {section === "retention" && ret && (
          <RetentionReport
            ret={ret}
            elections={elections}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
        {section === "participation" && (
          <ParticipationReport
            prof={prof}
            elections={elections}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
        {section === "geography" && (
          <GeographyReport
            rows={places}
            placeKey={placeKey}
            onPlaceKey={setPlaceKey}
            showAll={showAllPlaces}
            onShowAll={setShowAllPlaces}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
        {section === "registration" && (
          <RegistrationReport
            cohortRows={cohortRows}
            months={months}
            quality={quality}
            onDrill={onDrill}
            onExportCsv={onExportCsv}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- turnout ---

function TurnoutReport({
  rows,
  elections,
  onDrill,
  onExportCsv,
}: {
  rows: ReturnType<typeof cascade>;
  elections: Election[];
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const top = rows.reduce((a, b) => (b.voters > a.voters ? b : a), rows[0]);
  const live = rows.find((r) => r.provisional);
  const data: BarDatum[] = rows.map((r) => ({
    key: String(r.index),
    label: r.label,
    value: r.voters,
    fraction: r.share,
    valueLabel: num(r.voters),
    note: r.provisional ? " †" : r.countyWide ? undefined : " *",
    emphasis: r.voters === top.voters,
    hint: r.provisional
      ? `${num(r.voters)} early and absentee ballots returned so far, ${pct0(
          r.share,
        )} of the busiest election here, ${pct(r.ofEligible)} of this selection`
      : `${num(r.voters)} voters, ${pct0(r.share)} of the busiest election here, ${pct(
          r.ofEligible,
        )} of those eligible for it`,
  }));

  return (
    <section className="report">
      <h2>Turnout, election by election</h2>
      <p className="report-lede">
        Chronological rather than ranked — the point is the shape of the cycle,
        and sorting by size would hide it. Bars are scaled to the busiest
        election in this selection. <b>*</b> marks an election only part of the
        county could vote in.
        {live && (
          <>
            {" "}
            <b>†</b> marks an election still being voted: its bar is early and
            absentee ballots returned so far, not a turnout.
          </>
        )}{" "}
        Click a bar for the voters behind it.
      </p>
      <BarList
        data={data}
        onPick={(k) => {
          const i = Number(k);
          onDrill(`voted in ${elections[i].label}`, (v) =>
            Boolean(v.electionMask & (1 << i)),
          );
        }}
      />
      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            "turnout-by-election",
            ["Election", "County-wide", "In progress", "Voters", "Share of busiest", "Share of eligible"],
            rows.map((r) => [
              r.label,
              r.countyWide ? "Y" : "N",
              r.provisional ? "Y" : "N",
              r.voters,
              r.share.toFixed(4),
              r.ofEligible.toFixed(4),
            ]),
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}

// ----------------------------------------------------------- early voting ---

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-14" -> "Wed Oct 14" */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAY[dt.getDay()]} ${dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function EarlyVotingReport({
  ev,
  elections,
  placeKey,
  onPlaceKey,
  showAll,
  onShowAll,
  onDrill,
  onExportCsv,
}: {
  ev: NonNullable<ReturnType<typeof earlyVoting>>;
  elections: Election[];
  placeKey: "jurisdiction" | "precinct";
  onPlaceKey: (k: "jurisdiction" | "precinct") => void;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const liveIndex = elections.findIndex((e) => e.provisional);
  const liveBit = 1 << liveIndex;
  const baseIndex = elections.findIndex((e) => e.label === ev.profile.labels.baseline);
  const baseBit = baseIndex === -1 ? 0 : 1 << baseIndex;
  const asOf = ev.election.asOf ? formatDate(ev.election.asOf) : "";

  // --- daily curve, stacked by party ---
  const dayMax = Math.max(1, ...ev.days.map((d) => d.total));
  const partyMix = (by: Record<string, number>) =>
    ev.partyOrder
      .filter((p) => by[p])
      .map((p) => `${partyLabel(p)} ${num(by[p])}`)
      .join(", ");
  const dayBars: BarDatum[] = ev.days.map((d) => ({
    key: d.date,
    label: dayLabel(d.date),
    value: d.total,
    fraction: d.total / dayMax,
    valueLabel: num(d.total),
    note: d.mail > d.inPerson ? " ✉" : undefined,
    emphasis: d.total === dayMax,
    hint: `${num(d.inPerson)} in person, ${num(d.mail)} by mail — ${partyMix(d.byParty)} — ${num(d.cumulative)} returned by the end of the day`,
    segments: ev.partyOrder
      .filter((p) => d.byParty[p])
      .map((p) => ({
        key: p,
        fraction: d.byParty[p] / dayMax,
        color: partyColor(p),
        title: `${partyLabel(p)}: ${num(d.byParty[p])} of ${num(d.total)} on ${dayLabel(d.date)} — click to list them`,
        onPick: () =>
          onDrill(
            `${partyLabel(p)} voters who returned their ballot on ${dayLabel(d.date)}`,
            (v) => v.party === p && v.ballot?.returned === d.date,
          ),
      })),
  }));
  const partyKey = ev.partyOrder.map((p) => ({
    code: p,
    label: partyLabel(p),
    color: partyColor(p),
    count: ev.returnedByParty[p] ?? 0,
    share: ev.returned ? (ev.returnedByParty[p] ?? 0) / ev.returned : 0,
  }));

  // --- parties ---
  // Every figure is its own link, because "Democrat ballots by mail" and
  // "Democrat ballots back" are different lists; the row itself is the
  // party's ballots issued.
  const partyRows: RankRow[] = ev.parties.map((p) => {
    const name = partyLabel(p.party);
    const mine = (v: Voter) => v.party === p.party && v.ballot !== null;
    const mail = (v: Voter) => v.ballot?.category !== "EV";
    const cell = (text: string, what: string, pred: (v: Voter) => boolean) => ({
      text,
      title: `Show the ${name} voters ${what}`,
      onPick: () => onDrill(`${name} voters ${what}`, (v) => mine(v) && pred(v)),
    });
    return {
      key: p.party,
      name,
      fraction: p.mailRate,
      figures: [
        cell(num(p.issued), "issued a ballot", () => true),
        cell(num(p.returned), "whose ballot is back", (v) => v.ballotStatus === "voted"),
        cell(num(p.inPerson), "who voted early in person", (v) => v.ballot?.category === "EV"),
        cell(num(p.mailIssued), "issued a mail ballot", mail),
        cell(pct(p.mailRate), "whose mail ballot is back", (v) => mail(v) && v.ballotStatus === "voted"),
        cell(num(p.mailIssued - p.mailReturned), "whose mail ballot is still out", (v) => v.ballotStatus === "out"),
      ],
      title: `${name}: ${num(p.mailReturned)} of ${num(p.mailIssued)} mail ballots back — click a figure for those voters`,
      onPick: () => onDrill(`${name} voters issued a ballot`, mine),
    };
  });

  // --- pace ---
  const paceSource = (placeKey === "precinct" ? ev.pace.precincts : ev.pace.jurisdictions)
    .filter((r) => r.name !== NO_JURISDICTION);
  const paceShown = showAll ? paceSource : paceSource.slice(0, 12);
  const paceMax = Math.max(0.0001, ...paceSource.map((r) => r.pace));
  const paceRows: RankRow[] = paceShown.map((r) => {
    const here = (v: Voter) => v[placeKey] === r.name;
    const votedEarly = (v: Voter) => here(v) && (v.electionMask & liveBit) !== 0;
    return {
      key: r.name,
      name: r.name,
      fraction: r.pace / paceMax,
      figures: [
        {
          text: num(r.baseline),
          title: `Show the ${num(r.baseline)} voters in ${r.name} who voted in ${ev.profile.labels.baseline}`,
          onPick: () =>
            onDrill(`voted in ${ev.profile.labels.baseline} in ${r.name}`, (v) =>
              here(v) && (v.electionMask & baseBit) !== 0,
            ),
        },
        {
          text: num(r.voted),
          title: `Show the ${num(r.voted)} voters in ${r.name} who voted early`,
          onPick: () => onDrill(`voted early in ${r.name}`, votedEarly),
        },
        pct(r.pace),
        {
          text: num(r.out),
          title: `Show the ${num(r.out)} voters in ${r.name} whose ballot is still out`,
          onPick: () =>
            onDrill(`ballot still out in ${r.name}`, (v) =>
              here(v) && v.ballotStatus === "out",
            ),
        },
      ],
      title: `${r.name}: ${num(r.voted)} early votes against ${num(r.baseline)} who voted in ${ev.profile.labels.baseline}; ${num(r.out)} ballots still out`,
      onPick: () => onDrill(`voted early in ${r.name}`, votedEarly),
    };
  });

  // --- profile ---
  const prof = ev.profile;
  const prevIndex = elections.findIndex((e) => e.label === prof.labels.previousGeneral);
  const prevBit = prevIndex === -1 ? 0 : 1 << prevIndex;
  const primIndex = elections.findIndex((e) => e.label === prof.labels.primary);
  const primBit = primIndex === -1 ? 0 : 1 << primIndex;
  const finishedMask = elections.reduce(
    (m, e, i) => (e.provisional ? m : m | (1 << i)),
    0,
  );
  const votedEarly = (v: Voter) => (v.electionMask & liveBit) !== 0;
  const skippedBaselineLabel = `voted early but sat out ${prof.labels.baseline}`;
  const skippedBaseline = (v: Voter) =>
    votedEarly(v) &&
    (v.electionMask & baseBit) === 0 &&
    (v.electionMask & ~liveBit) !== 0;
  const priorMax = Math.max(1, ...prof.byPrior);
  const priorBars: BarDatum[] = prof.byPrior.map((count, k) => ({
    key: String(k),
    label: k === 0 ? "none before" : k === 1 ? "1 election" : `${k} elections`,
    value: count,
    fraction: count / priorMax,
    valueLabel: num(count),
    hint: `${num(count)} early voters had voted in exactly ${k} of the ${prof.byPrior.length - 1} finished elections on file`,
  }));

  return (
    <section className="report">
      <h2>Early voting — {ev.election.label}</h2>
      <p className="report-lede">
        From the Board of Elections' absentee file, through <b>{asOf}</b>
        {ev.election.electionDate && (
          <>; election day is {formatDate(ev.election.electionDate)}</>
        )}
        . A returned ballot is a vote; a ballot issued and not back is not.
        Nothing here is a forecast — the pace figures compare early votes so
        far with who turned out <em>last time</em>, and election day is still
        to come.
      </p>

      <div className="viz-stats">
        <StatTile
          label="ballots returned — votes so far"
          value={num(ev.returned)}
          note={partyKey.map((k) => `${k.label} ${pct0(k.share)}`).join(" · ")}
          pickTitle={`Show the ${num(ev.returned)} voters whose ballot is back`}
          onPick={() => onDrill("voted early", (v) => v.ballotStatus === "voted")}
        />
        <StatTile
          label="ballots issued and still out"
          value={num(ev.out)}
          note={`${pct(ev.issued ? ev.out / ev.issued : 0)} of ${num(ev.issued)} issued`}
          pickTitle={`Show the ${num(ev.out)} voters whose ballot is still out`}
          onPick={() => onDrill("ballot still out", (v) => v.ballotStatus === "out")}
        />
        <StatTile
          label="of the registered voters here have voted"
          value={pct(ev.selection ? ev.returned / ev.selection : 0)}
          note={`${num(ev.returned)} of ${num(ev.selection)} in this selection`}
          pickTitle={`Show the ${num(ev.returned)} voters who have voted`}
          onPick={() => onDrill("voted early", (v) => v.ballotStatus === "voted")}
        />
      </div>

      <h3>Ballots returned per day, by party</h3>
      <p className="report-lede">
        Each day's bar is split by party — Ohio has no party registration, so
        this is the last primary ballot the Board recorded, and{" "}
        <em>Unaffiliated</em> is everyone with none. In-person early votes are
        a steady daily count; mail arrives in postal batches, which is where
        the spikes come from. <b>✉</b> marks a day where mail outnumbered
        in-person; hover for the split, the party mix and the running total.
        Returns before early voting opened are military and overseas ballots,
        which go out electronically weeks earlier. Click a day for its voters,
        a coloured segment for that party on that day, or a party in the key
        for that party's early voters.
      </p>
      <div className="viz-key" role="list" aria-label="Early votes by party">
        {partyKey.map((k) => (
          <button
            type="button"
            className="viz-key-item is-clickable"
            key={k.code}
            role="listitem"
            title={`${num(k.count)} ${k.label} early votes — click to list them`}
            onClick={() =>
              onDrill(`${k.label} voters who voted early`, (v) =>
                v.party === k.code && (v.electionMask & liveBit) !== 0,
              )
            }
          >
            <span className="legend-dot" style={{ background: k.color }} />
            {k.label} <b>{num(k.count)}</b>
            <span className="viz-key-share">{pct(k.share)}</span>
          </button>
        ))}
      </div>
      <BarList
        data={dayBars}
        onPick={(k) =>
          onDrill(`returned their ballot on ${dayLabel(k)}`, (v) => v.ballot?.returned === k)
        }
      />

      <h3>Mail ballots by party</h3>
      <p className="report-lede">
        Who asked for a ballot by mail, and how many have come back. The bar is
        the mail return rate. Ohio has no party registration, so party is the
        last primary ballot the Board recorded. Click any figure for exactly
        those voters — the party name is everyone issued a ballot.
      </p>
      <RankTable
        nameHeading="Party"
        columns={["Issued", "Returned", "In person", "By mail", "Mail back", "Still out"]}
        rows={partyRows}
      />

      <h3>Pace against {prof.labels.baseline}</h3>
      <p className="report-lede">
        Early votes so far as a share of the people in each place who voted in{" "}
        {prof.labels.baseline} — the last finished general of the same kind of
        year on file. It is a
        comparison of pace, not a prediction of turnout: the denominator is who
        showed up last time, not who is registered. Places with fewer than{" "}
        {placeKey === "precinct" ? 150 : 100} {prof.labels.baseline} voters are
        left out. Click a row for its early voters, or a figure for the voters
        behind it.
      </p>
      <div className="report-switch">
        <button
          type="button"
          className={placeKey === "jurisdiction" ? "active" : ""}
          onClick={() => onPlaceKey("jurisdiction")}
        >
          Jurisdiction
        </button>
        <button
          type="button"
          className={placeKey === "precinct" ? "active" : ""}
          onClick={() => onPlaceKey("precinct")}
        >
          Precinct
        </button>
      </div>
      <RankTable
        nameHeading={placeKey === "precinct" ? "Precinct" : "Jurisdiction"}
        columns={[prof.labels.baseline, "Voted early", "Pace", "Still out"]}
        rows={paceRows}
      />
      {paceSource.length > 12 && (
        <button
          type="button"
          className="report-more"
          onClick={() => onShowAll(!showAll)}
        >
          {showAll ? "Show the top 12" : `Show all ${paceSource.length}`}
        </button>
      )}

      <h3>Who the early voters are</h3>
      <p className="report-lede">
        The early voters' own history, over the finished elections on file.
        Click a bar for those voters.
      </p>
      <div className="viz-stats">
        {prof.labels.previousGeneral && (
          <StatTile
            label={`voted in both ${prof.labels.previousGeneral} and ${prof.labels.baseline}`}
            value={`${num(prof.bothGenerals)} · ${pct(prof.voted ? prof.bothGenerals / prof.voted : 0)}`}
            pickTitle={`Show the ${num(prof.bothGenerals)} early voters who voted in both ${prof.labels.previousGeneral} and ${prof.labels.baseline}`}
            onPick={() =>
              onDrill(
                `voted early, and in both ${prof.labels.previousGeneral} and ${prof.labels.baseline}`,
                (v) =>
                  votedEarly(v) &&
                  (v.electionMask & baseBit) !== 0 &&
                  (v.electionMask & prevBit) !== 0,
              )
            }
          />
        )}
        {prof.labels.primary && (
          <StatTile
            label={`voted in the ${prof.labels.primary}`}
            value={`${num(prof.lastPrimary)} · ${pct(prof.voted ? prof.lastPrimary / prof.voted : 0)}`}
            pickTitle={`Show the ${num(prof.lastPrimary)} early voters who voted in the ${prof.labels.primary}`}
            onPick={() =>
              onDrill(`voted early, and in the ${prof.labels.primary}`, (v) =>
                votedEarly(v) && (v.electionMask & primBit) !== 0,
              )
            }
          />
        )}
        <StatTile
          label={`on file but sat out ${prof.labels.baseline}`}
          value={num(prof.skippedBaseline)}
          pickTitle={`Show the ${num(prof.skippedBaseline)} early voters who sat out ${prof.labels.baseline}`}
          onPick={() => onDrill(skippedBaselineLabel, skippedBaseline)}
        />
        <StatTile
          label="first vote on file"
          value={num(prof.firstVote)}
          note="added from the absentee file; no earlier election on record"
          pickTitle={`Show the ${num(prof.firstVote)} early voters with no earlier election on file`}
          onPick={() =>
            onDrill("voted early, first vote on file", (v) =>
              votedEarly(v) && (v.electionMask & finishedMask) === 0,
            )
          }
        />
      </div>
      <BarList
        caption="Early voters by how many finished elections they had voted in"
        data={priorBars}
        onPick={(k) => {
          const n = Number(k);
          onDrill(`voted early, with ${n} prior election${n === 1 ? "" : "s"} on file`, (v) =>
            (v.electionMask & liveBit) !== 0 && popcount(v.electionMask & ~liveBit) === n,
          );
        }}
      />
      {baseBit !== 0 && (
        <p className="report-lede">
          The {num(prof.skippedBaseline)} who sat out {prof.labels.baseline} are{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => onDrill(skippedBaselineLabel, skippedBaseline)}
          >
            here
          </button>
          .
        </p>
      )}

      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            "early-voting",
            ["Section", "Name", "Issued / baseline", "Returned / voted", "In person", "By mail", "Rate", "Still out", "Cumulative"],
            [
              ...ev.days.map((d) => [
                "Day", d.date, "", d.total, d.inPerson, d.mail,
                ev.partyOrder.map((p) => `${partyLabel(p)} ${d.byParty[p] ?? 0}`).join("; "),
                "", d.cumulative,
              ]),
              ...ev.parties.map((p) => ["Party", partyLabel(p.party), p.issued, p.returned, p.inPerson, p.mailIssued, p.mailRate.toFixed(4), p.mailIssued - p.mailReturned, ""]),
              ...paceSource.map((r) => ["Pace " + placeKey, r.name, r.baseline, r.voted, "", "", r.pace.toFixed(4), r.out, ""]),
              ...prof.byPrior.map((n, k) => ["Prior elections", String(k), "", n, "", "", "", "", ""]),
            ],
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}

// -------------------------------------------------------------- retention ---

function RetentionReport({
  ret,
  elections,
  onDrill,
  onExportCsv,
}: {
  ret: NonNullable<ReturnType<typeof retention>>;
  elections: Election[];
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const short = ret.labels.map((l) =>
    l.replace(" Special", " Spec").replace("Feb 2026 Cortland Spec", "Cortland"),
  );
  const cells: HeatCell[][] = ret.rows.map((row, i) =>
    row.map((c, j) => ({
      key: `${i}-${j}`,
      fraction: c.share,
      text: i === j ? "" : pct0(c.share),
      diagonal: i === j,
      title:
        i === j
          ? `${ret.labels[i]}: ${num(ret.totals[i])} voters`
          : `Of the ${num(ret.totals[i])} who voted in ${ret.labels[i]}, ${num(
              c.both,
            )} (${pct(c.share)}) also voted in ${ret.labels[j]}`,
      onPick: () =>
        onDrill(
          `voted in both ${elections[i].label} and ${elections[j].label}`,
          (v) =>
            Boolean(v.electionMask & (1 << i)) &&
            Boolean(v.electionMask & (1 << j)),
        ),
    })),
  );

  return (
    <section className="report">
      <h2>Who came back</h2>
      <p className="report-lede">
        Of the people who voted in the <b>row</b> election, the share who also
        voted in the <b>column</b> one. Read it one row at a time; the grid is
        deliberately asymmetric, and which direction you read is the finding.
        Click any cell for the voters in both.
      </p>
      <HeatGrid
        rowHeading="Voted in…"
        columnHeading="…also voted in"
        rowLabels={short}
        columnLabels={short}
        cells={cells}
      />
      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            "retention",
            ["Voted in", ...ret.labels],
            ret.rows.map((row, i) => [
              ret.labels[i],
              ...row.map((c) => c.share.toFixed(4)),
            ]),
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}

// ---------------------------------------------------------- participation ---

function ParticipationReport({
  prof,
  elections,
  onDrill,
  onExportCsv,
}: {
  prof: ReturnType<typeof profile>;
  elections: Election[];
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const max = Math.max(1, ...prof.byCount.slice(1));
  // The same season masks profile() uses, so a clicked bar lists exactly the
  // voters it counted.
  let pMask = 0;
  let gMask = 0;
  let sMask = 0;
  elections.forEach((e, i) => {
    const b = 1 << i;
    if (e.season === "primary") pMask |= b;
    else if (e.season === "general") gMask |= b;
    else sMask |= b;
  });
  const has = (v: Voter, m: number) => (v.electionMask & m) !== 0;
  const habitPick = (k: string) => {
    if (k === "both")
      onDrill("voted in generals and primaries", (v) => has(v, pMask) && has(v, gMask));
    else if (k === "g")
      onDrill("voted in generals only", (v) => has(v, gMask) && !has(v, pMask));
    else if (k === "p")
      onDrill("voted in primaries only", (v) => has(v, pMask) && !has(v, gMask));
    else if (k === "s")
      onDrill(
        "voted in specials only",
        (v) => !has(v, pMask) && !has(v, gMask) && has(v, sMask),
      );
  };
  const data: BarDatum[] = prof.byCount
    .map((count, k) => ({ count, k }))
    .filter((r) => r.k > 0)
    .map(({ count, k }) => ({
      key: String(k),
      label: k === 1 ? "1 election" : `${k} elections`,
      value: count,
      fraction: count / max,
      valueLabel: num(count),
      hint: `${num(count)} voters turned out for exactly ${k} of the ${prof.window} on file`,
    }));

  const habit: BarDatum[] = [
    { key: "both", label: "Generals and primaries", value: prof.bothKinds },
    { key: "g", label: "Generals only", value: prof.generalsOnly },
    { key: "p", label: "Primaries only", value: prof.primariesOnly },
    { key: "s", label: "Specials only", value: prof.specialsOnly },
  ].map((r) => ({
    ...r,
    fraction: r.value / Math.max(1, prof.bothKinds, prof.generalsOnly),
    valueLabel: num(r.value),
  }));

  return (
    <section className="report">
      <h2>How often people turn out</h2>

      <div className="viz-stats">
        <StatTile
          label="voted in every election they were eligible for"
          value={num(prof.everyEligible)}
          note={`a strict reading that ignored eligibility would say ${num(
            prof.everyOnFile,
          )}`}
          pickTitle={`Show the ${num(prof.everyEligible)} voters who voted in every election they were eligible for`}
          onPick={() =>
            onDrill(
              "voted in every election they were eligible for",
              (v) =>
                v.eligibleMask !== 0 &&
                (v.electionMask & v.eligibleMask) === v.eligibleMask,
            )
          }
        />
        <StatTile
          label="voted exactly once"
          value={num(prof.exactlyOne)}
          note={`counted against a window of ${prof.window} elections — a longer file would move this`}
          pickTitle={`Show the ${num(prof.exactlyOne)} voters who voted exactly once`}
          onPick={() =>
            onDrill("voted in exactly 1 election", (v) => popcount(v.electionMask) === 1)
          }
        />
        <StatTile
          label="mean share of eligible elections voted"
          value={pct(prof.meanRate)}
        />
      </div>

      <h3>Voters by how many elections they turned out for</h3>
      <p className="report-lede">
        Click a bar to open those voters in the list. This is the segmentation
        worth exporting: the right-hand bars are the people who vote in
        everything, the left-hand bar is the bulk of the roll.
      </p>
      <BarList
        data={data}
        onPick={(k) => {
          const n = Number(k);
          onDrill(`voted in exactly ${n} election${n === 1 ? "" : "s"}`, (v) =>
            popcount(v.electionMask) === n,
          );
        }}
      />

      <h3>Generals, primaries, or both</h3>
      <p className="report-lede">
        Primary voters are very nearly a subset of general-election voters —
        the reverse is not remotely true. Click a bar for those voters.
      </p>
      <BarList data={habit} onPick={habitPick} />

      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            "participation-profile",
            ["Elections voted in", "Voters"],
            prof.byCount.map((c, k) => [k, c]).filter(([k]) => Number(k) > 0),
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}

// -------------------------------------------------------------- geography ---

function GeographyReport({
  rows,
  placeKey,
  onPlaceKey,
  showAll,
  onShowAll,
  onDrill,
  onExportCsv,
}: {
  rows: ReturnType<typeof geography>;
  placeKey: "jurisdiction" | "precinct";
  onPlaceKey: (k: "jurisdiction" | "precinct") => void;
  showAll: boolean;
  onShowAll: (b: boolean) => void;
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const shown = showAll ? rows : rows.slice(0, 12);
  const max = Math.max(0.0001, ...rows.map((r) => r.meanRate));
  const kind = placeKey === "precinct" ? "precinct" : "jurisdiction";
  const table: RankRow[] = shown.map((r) => {
    const here = (v: Voter) => v[placeKey] === r.name;
    return {
      key: r.name,
      name: r.name,
      fraction: r.meanRate / max,
      figures: [
        num(r.onFile),
        pct(r.meanRate),
        {
          text: pct(r.faithful / r.onFile),
          title: `Show the ${num(r.faithful)} voters in ${r.name} who voted in at least 80% of their elections`,
          onPick: () =>
            onDrill(`voted 80%+ in ${kind} ${r.name}`, (v) => {
              const ne = popcount(v.eligibleMask);
              return here(v) && ne > 0 && popcount(v.electionMask) / ne >= 0.8;
            }),
        },
        {
          text: pct(r.onceOnly / r.onFile),
          title: `Show the ${num(r.onceOnly)} voters in ${r.name} who voted exactly once`,
          onPick: () =>
            onDrill(`voted once in ${kind} ${r.name}`, (v) =>
              here(v) && popcount(v.electionMask) === 1,
            ),
        },
      ],
      title: `${r.name}: ${num(r.onFile)} voters on file, mean ${pct(r.meanRate)} — click the row for all of them`,
      onPick: () => onDrill(`${kind} ${r.name}`, here),
    };
  });

  return (
    <section className="report">
      <h2>Participation by place</h2>
      <p className="report-lede">
        Mean share of the elections a voter was eligible for, averaged over
        everyone in the place. Places with fewer than{" "}
        {placeKey === "precinct" ? 150 : 100} voters are left out — a rate over a
        handful of people ranks first or last by accident. Click a row to filter
        the whole app to it, or the last two columns for just those voters.
      </p>
      <div className="report-switch">
        <button
          type="button"
          className={placeKey === "jurisdiction" ? "active" : ""}
          onClick={() => onPlaceKey("jurisdiction")}
        >
          Jurisdiction
        </button>
        <button
          type="button"
          className={placeKey === "precinct" ? "active" : ""}
          onClick={() => onPlaceKey("precinct")}
        >
          Precinct
        </button>
      </div>
      <RankTable
        nameHeading={placeKey === "precinct" ? "Precinct" : "Jurisdiction"}
        columns={["On file", "Mean", "Voted 80%+", "Voted once"]}
        rows={table}
      />
      {rows.length > 12 && (
        <button
          type="button"
          className="report-more"
          onClick={() => onShowAll(!showAll)}
        >
          {showAll ? "Show the top 12" : `Show all ${rows.length}`}
        </button>
      )}
      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            `participation-by-${placeKey}`,
            [placeKey === "precinct" ? "Precinct" : "Jurisdiction", "On file", "Mean rate", "Voted 80%+", "Voted once"],
            rows.map((r) => [
              r.name,
              r.onFile,
              r.meanRate.toFixed(4),
              r.faithful,
              r.onceOnly,
            ]),
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}

// ----------------------------------------------------------- registration ---

function RegistrationReport({
  cohortRows,
  months,
  quality,
  onDrill,
  onExportCsv,
}: {
  cohortRows: ReturnType<typeof cohorts>;
  months: ReturnType<typeof registrationsByMonth>;
  quality: ReturnType<typeof addressQuality>;
  onDrill: ReportsViewProps["onDrill"];
  onExportCsv: ReportsViewProps["onExportCsv"];
}) {
  const cMax = Math.max(0.0001, ...cohortRows.map((c) => c.meanRate));
  const cohortBars: BarDatum[] = cohortRows.map((c) => ({
    key: c.label,
    label: c.label,
    value: c.onFile,
    fraction: c.meanRate / cMax,
    valueLabel: pct(c.meanRate),
    hint: `${num(c.onFile)} voters registered in ${c.label}, mean ${pct(c.meanRate)}`,
  }));

  // The four biggest months, named on the plot; the rest carry the shape.
  const marked = new Set(
    [...months].sort((a, b) => b.count - a.count).slice(0, 4).map((m) => m.month),
  );
  const linePoints = months.map((m) => ({
    x: m.month,
    y: m.count,
    label: `${m.month}: ${num(m.count)} registrations`,
  }));

  const qMax = Math.max(0.0001, ...quality.map((q) => q.rate));
  const qRows: RankRow[] = quality.slice(0, 12).map((q) => ({
    key: q.city,
    name: q.city,
    fraction: q.rate / qMax,
    figures: [
      {
        text: num(q.onFile),
        title: `Show the ${num(q.onFile)} voters with a ${q.city} mailing address`,
        onPick: () => onDrill(`mailing city ${q.city}`, (v) => v.city === q.city),
      },
      num(q.unplaced),
      pct(q.rate),
    ],
    title: `${q.city}: ${num(q.unplaced)} of ${num(q.onFile)} addresses unplaced — click for them`,
    onPick: () => onDrill(`unplaced addresses in ${q.city}`, (v) =>
      v.city === q.city && v.lat == null,
    ),
  }));

  return (
    <section className="report">
      <h2>Registration and data quality</h2>

      <h3>Participation by registration cohort</h3>
      <p className="report-lede">
        Bars are the mean share of eligible elections voted; the hover gives the
        size of each cohort. Newer registrants have had fewer chances, but the
        gradient runs well past what that explains. Click a bar for that
        cohort's voters.
      </p>
      <BarList
        data={cohortBars}
        onPick={(label) =>
          onDrill(`registered in ${label}`, (v) => {
            // Mirrors cohorts(): a year on its own, or a decade with an "s".
            const y = Number(v.registered.slice(0, 4));
            if (!y) return false;
            return label.endsWith("s")
              ? Math.floor(y / 10) * 10 === Number(label.slice(0, -1))
              : y === Number(label);
          })
        }
      />

      {linePoints.length > 1 && (
        <>
          <h3>Registrations per month</h3>
          <p className="report-lede">
            Only registrations that later produced a vote appear in this file, so
            the shape is trustworthy and the level is not. The peaks are
            registration deadlines. The four largest months are marked.
          </p>
          <LineChart points={linePoints} marked={marked} />
        </>
      )}

      {qRows.length > 0 && (
        <>
          <h3>Addresses the geocoder could not place</h3>
          <p className="report-lede">
            By mailing city, worst first — this is the to-do list for
            <code> scripts/geocode-voters.mjs</code>, and it should shrink when
            that script improves. Click a row for the voters concerned.
          </p>
          <RankTable
            nameHeading="Mailing city"
            columns={["On file", "Unplaced", "Rate"]}
            rows={qRows}
          />
        </>
      )}

      <button
        type="button"
        className="report-export"
        onClick={() =>
          onExportCsv(
            "registration-cohorts",
            ["Cohort", "On file", "Mean rate"],
            cohortRows.map((c) => [c.label, c.onFile, c.meanRate.toFixed(4)]),
          )
        }
      >
        Export this report to CSV
      </button>
    </section>
  );
}
