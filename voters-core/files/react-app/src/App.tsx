import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import BuildStamp from "./components/BuildStamp";
import CountLink from "./components/CountLink";
import HelpDrawer from "./components/HelpDrawer";
import MainMenu, { type AppView } from "./components/MainMenu";
import { useBaseMap } from "./vendor/basemaps/useBaseMap";
import ElectionMatchToggle from "./components/ElectionMatchToggle";
import MultiSelectFilter from "./components/MultiSelectFilter";
import Pager from "./components/Pager";
import SuggestEditDialog from "./components/SuggestEditDialog";
import VoterDialog from "./components/VoterDialog";
import VoterMap, { type MapColorBy } from "./components/VoterMap";
import VoterTable, { type SortKey } from "./components/VoterTable";
import type { MappedVoter } from "./components/VoterCanvasLayer";
import { loadVoters, toCsv, type NamedCount } from "./data/loadVoters";
import ReportsView from "./reports/ReportsView";
import type { ElectionMatch, Voter, VoterMeta } from "./types/voter";
import { COUNTY_NAME } from "./config/county";
import {
  BALLOT_STATUS_ORDER,
  ballotStatusColor,
  ballotStatusHelp,
  ballotStatusLabel,
  compareStreets,
  formatDate,
  isMapped,
  isProvisional,
  NO_JURISDICTION,
  partyColor,
  partyLabel,
} from "./types/voter";

/** Distinct values of a field across the whole dataset, sorted for display. */
function domainOf(voters: Voter[], pick: (v: Voter) => string): string[] {
  return [...new Set(voters.map(pick))].sort((a, b) => a.localeCompare(b));
}

/**
 * Option list for one facet: the full domain (so nothing becomes unselectable),
 * with counts taken from `subset` — the rows matching the search and the OTHER
 * facets. That way each count is "how many more rows would this option show".
 */
function facetOptions(
  domain: string[],
  subset: Voter[],
  pick: (v: Voter) => string,
): NamedCount[] {
  const tally = new Map<string, number>();
  for (const v of subset) {
    const k = pick(v);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return domain.map((name) => ({ name, count: tally.get(name) ?? 0 }));
}

interface Drill {
  label: string;
  predicate: (v: Voter) => boolean;
}

/**
 * The Elections filter's extra row for the registered voters who have no
 * ballot in any election the dataset covers. The roll is the whole
 * registration, not just people who turned out, so without this row the
 * default "any" view would silently drop everyone who has not voted since the
 * dataset's first election. The label is the row's key, so it needs no
 * special handling in the multi-select; it is never in electionDomain, so it
 * never gets a bit.
 */
function neverVotedLabel(m: VoterMeta | null): string {
  const first = m?.elections.find((e) => !e.provisional);
  return first ? `No elections since ${first.year}` : "No elections";
}

export default function App() {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [meta, setMeta] = useState<VoterMeta | null>(null);
  // Only ever read on a narrow screen; the toggle is display:none above it.
  const [statsOpen, setStatsOpen] = useState(false);
  /**
   * Filters handed over by a click on a count - "the voters behind this
   * number". Held apart from the named filters because they have no control
   * of their own: each arrives from a click, shows as a removable chip under
   * the filter bar, and clears with the rest. The predicate is carried rather
   * than re-derived so a count can drill on anything it can compute, not only
   * on what the filter bar can express.
   *
   * They stack and AND together, because every count on screen is already
   * over the current selection - drills included. Click a day's bar, then a
   * party's count, and the list is that party on that day, which is exactly
   * the number that was clicked. Replacing one drill with the next would show
   * a different set from the one counted.
   */
  const [drills, setDrills] = useState<Drill[]>([]);
  /** Add a drill, unless the same one is already applied. */
  const addDrill = useCallback((label: string, predicate: (v: Voter) => boolean) => {
    setDrills((ds) =>
      ds.some((d) => d.label === label) ? ds : [...ds, { label, predicate }],
    );
    setPage(0);
  }, []);
  const removeDrill = (label: string) =>
    setDrills((ds) => ds.filter((d) => d.label !== label));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  // Keeps typing responsive: filtering runs against the deferred value.
  const deferredQuery = useDeferredValue(query);

  const [parties, setParties] = useState<Set<string>>(new Set());
  const [jurisdictions, setJurisdictions] = useState<Set<string>>(new Set());
  const [precincts, setPrecincts] = useState<Set<string>>(new Set());
  const [elections, setElections] = useState<Set<string>>(new Set());
  /** "any" = voted in at least one ticked election; "all" = every one. */
  const [electionMatch, setElectionMatch] = useState<ElectionMatch>("any");
  /**
   * Early-voting status filter: voted / ballot out / none. Only shown while
   * the dataset carries a provisional election; starts with all three ticked.
   */
  const [ballotStatuses, setBallotStatuses] = useState<Set<string>>(
    new Set(BALLOT_STATUS_ORDER),
  );
  /** What the map dots are coloured by. Party unless early voting is chosen. */
  const [mapColorBy, setMapColorBy] = useState<MapColorBy>("party");

  const [sortKey, setSortKey] = useState<SortKey>("lastName");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  const [selected, setSelected] = useState<Voter | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Voter whose "Suggest an Edit" form is open, if any. */
  const [editVoter, setEditVoter] = useState<Voter | null>(null);
  const [view, setView] = useState<AppView>("list");
  const [baseMap, setBaseMap] = useBaseMap();
  /** Leaflet instance, once the map view has mounted. Used by "Show on map". */
  const mapRef = useRef<LeafletMap | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // "?" opens help from anywhere except a text field (fleet convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Empty the search box and put the cursor back in it. */
  const clearSearch = () => {
    setQuery("");
    setPage(0);
    searchRef.current?.focus();
  };

  // --- Load the bundled dataset once, and start with every facet selected. ---
  useEffect(() => {
    let cancelled = false;
    loadVoters()
      .then(({ meta: m, voters: vs }) => {
        if (cancelled) return;
        setVoters(vs);
        setMeta(m);
        setParties(new Set(vs.map((v) => v.party)));
        setJurisdictions(new Set(vs.map((v) => v.jurisdiction)));
        setPrecincts(new Set(vs.map((v) => v.precinct)));
        setElections(new Set([...m.elections.map((e) => e.label), neverVotedLabel(m)]));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Facet domains (stable for the life of the dataset) ---
  // Parties sort by display name (Democrat, Libertarian, Republican,
  // Unaffiliated) rather than by the raw "--"/D/L/R codes.
  const partyDomain = useMemo(
    () =>
      [...new Set(voters.map((v) => v.party))].sort((a, b) =>
        partyLabel(a).localeCompare(partyLabel(b)),
      ),
    [voters],
  );
  /**
   * Civil jurisdictions, with the "No jurisdiction" bucket pinned to the
   * bottom - it is a data-quality bucket, not a place, and shouldn't sit
   * between Newton Falls and Niles.
   */
  const jurisdictionDomain = useMemo(() => {
    const all = domainOf(voters, (v) => v.jurisdiction);
    return [
      ...all.filter((j) => j !== NO_JURISDICTION),
      ...all.filter((j) => j === NO_JURISDICTION),
    ];
  }, [voters]);
  const precinctDomain = useMemo(
    () => domainOf(voters, (v) => v.precinct),
    [voters],
  );
  /** Election labels in chronological order, straight from the dataset. */
  const electionDomain = useMemo(
    () => (meta?.elections ?? []).map((e) => e.label),
    [meta],
  );
  const neverVoted = useMemo(() => neverVotedLabel(meta), [meta]);
  /** Rows in the Elections filter: every election plus the never-voted row. */
  const electionFilterTotal = electionDomain.length + 1;
  /** The election still being voted, if the absentee file is merged in. */
  const liveElection = useMemo(
    () => (meta?.elections ?? []).find(isProvisional) ?? null,
    [meta],
  );
  /** Early-voting statuses present, in their fixed order. */
  const ballotDomain = useMemo(
    () => (liveElection ? BALLOT_STATUS_ORDER.map(String) : []),
    [liveElection],
  );
  const matchesBallot = useCallback(
    (v: Voter) => !liveElection || ballotStatuses.has(v.ballotStatus),
    [liveElection, ballotStatuses],
  );

  /**
   * The ticked elections as a bitmask, so filtering is one AND per voter
   * instead of a Set lookup per election.
   */
  const electionMask = useMemo(() => {
    let mask = 0;
    electionDomain.forEach((label, i) => {
      if (elections.has(label)) mask |= 1 << i;
    });
    return mask;
  }, [electionDomain, elections]);

  /**
   * Does this voter's history satisfy the election filter as configured?
   *
   * "all" is eligibility-aware on purpose: it asks whether they voted in every
   * ticked election they could actually vote in. A Warren voter who turned out
   * for all three county-wide elections has never missed one, and a
   * Cortland-only special they were never on the ballot for should not be what
   * disqualifies them. A voter eligible for none of the ticked elections drops
   * out rather than passing vacuously.
   */
  /** Bit of the election in progress, or 0 when there is none. */
  const liveBit = useMemo(() => {
    const i = liveElection ? electionDomain.indexOf(liveElection.label) : -1;
    return i === -1 ? 0 : 1 << i;
  }, [liveElection, electionDomain]);
  const matchesElections = useCallback(
    (v: Voter) => {
      // Registered, no ballot in any election here (a ballot still out in the
      // election in progress is handled below, not here): shown only when the
      // "No elections since ..." row is ticked, and in "all" mode only when it
      // is the only thing ticked - "voted in every ticked election" is false
      // for someone who voted in none of them.
      if (v.electionMask === 0 && v.ballotStatus !== "out") {
        return elections.has(neverVoted) && (electionMatch !== "all" || electionMask === 0);
      }
      if (electionMask === 0) return false; // no election ticked, no voter shown
      if (electionMatch !== "all") {
        if ((v.electionMask & electionMask) !== 0) return true;
        // A ballot that is out is part of the election in progress even
        // though it is not a vote yet. Without this, a first-time voter whose
        // ballot has not come back has no election bit at all and would
        // vanish from the list, the Ballot out count included.
        return (electionMask & liveBit) !== 0 && v.ballotStatus === "out";
      }
      const needed = electionMask & v.eligibleMask;
      return needed !== 0 && (v.electionMask & needed) === needed;
    },
    [electionMask, electionMatch, liveBit, elections, neverVoted],
  );

  // --- Free-text pass, done first because every facet count builds on it. ---
  const afterQuery = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return voters;
    // Space-separated terms must ALL match, so "smith warren" narrows properly.
    const terms = q.split(/\s+/);
    return voters.filter((v) => terms.every((t) => v.search.includes(t)));
  }, [voters, deferredQuery]);

  // --- Facet option counts, each ignoring its own selection ---
  const partyOptions = useMemo(
    () =>
      facetOptions(
        partyDomain,
        afterQuery.filter(
          (v) =>
            jurisdictions.has(v.jurisdiction) &&
            precincts.has(v.precinct) &&
            matchesElections(v) &&
            matchesBallot(v),
        ),
        (v) => v.party,
      ),
    [partyDomain, afterQuery, jurisdictions, precincts, matchesElections, matchesBallot],
  );
  const jurisdictionOptions = useMemo(
    () =>
      facetOptions(
        jurisdictionDomain,
        afterQuery.filter(
          (v) =>
            parties.has(v.party) &&
            precincts.has(v.precinct) &&
            matchesElections(v) &&
            matchesBallot(v),
        ),
        (v) => v.jurisdiction,
      ),
    [jurisdictionDomain, afterQuery, parties, precincts, matchesElections, matchesBallot],
  );
  const precinctOptions = useMemo(
    () =>
      facetOptions(
        precinctDomain,
        afterQuery.filter(
          (v) =>
            parties.has(v.party) &&
            jurisdictions.has(v.jurisdiction) &&
            matchesElections(v) &&
            matchesBallot(v),
        ),
        (v) => v.precinct,
      ),
    [precinctDomain, afterQuery, parties, jurisdictions, matchesElections, matchesBallot],
  );
  /** Early-voting counts, given search and the other facets. */
  const ballotOptions = useMemo(
    () =>
      facetOptions(
        ballotDomain,
        afterQuery.filter(
          (v) =>
            parties.has(v.party) &&
            jurisdictions.has(v.jurisdiction) &&
            precincts.has(v.precinct) &&
            matchesElections(v),
        ),
        (v) => v.ballotStatus,
      ),
    [ballotDomain, afterQuery, parties, jurisdictions, precincts, matchesElections],
  );

  /**
   * Turnout per election among the rows the OTHER filters allow. Deliberately
   * ignores the election selection itself - including the any/all mode - so the
   * numbers stay a stable read of "how many of these voters turned out for
   * this election" rather than shifting as you tick boxes.
   */
  const electionOptions = useMemo(() => {
    const base = afterQuery.filter(
      (v) =>
        parties.has(v.party) &&
        jurisdictions.has(v.jurisdiction) &&
        precincts.has(v.precinct) &&
        matchesBallot(v),
    );
    const rows = electionDomain.map((name, i) => ({
      name,
      count: base.reduce((n, v) => (v.electionMask & (1 << i) ? n + 1 : n), 0),
    }));
    rows.push({
      name: neverVoted,
      count: base.reduce((n, v) => (v.electionMask === 0 && v.ballotStatus !== "out" ? n + 1 : n), 0),
    });
    return rows;
  }, [electionDomain, neverVoted, afterQuery, parties, jurisdictions, precincts, matchesBallot]);

  // --- Everything matching search + all the facets ---
  const matched = useMemo(
    () =>
      afterQuery.filter(
        (v) =>
          parties.has(v.party) &&
          jurisdictions.has(v.jurisdiction) &&
          precincts.has(v.precinct) &&
          matchesElections(v) &&
          matchesBallot(v) &&
          drills.every((d) => d.predicate(v)),
      ),
    [afterQuery, parties, jurisdictions, precincts, matchesElections, matchesBallot, drills],
  );

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    const out = [...matched];
    out.sort((a, b) => {
      let c = 0;
      switch (sortKey) {
        case "id":
          c = a.id - b.id;
          break;
        case "party":
          c = partyLabel(a.party).localeCompare(partyLabel(b.party));
          break;
        case "street":
          // Street name first, then up the street numerically.
          c = compareStreets(a.street, b.street);
          break;
        case "ballot":
          // Voted, then ballot out, then nobody - and within a state, by the
          // most recent movement so the newest returns sit together.
          c =
            BALLOT_STATUS_ORDER.indexOf(a.ballotStatus) -
              BALLOT_STATUS_ORDER.indexOf(b.ballotStatus) ||
            (b.ballot?.returned ?? "").localeCompare(a.ballot?.returned ?? "") ||
            (b.ballot?.issued ?? "").localeCompare(a.ballot?.issued ?? "");
          break;
        default:
          c = String(a[sortKey]).localeCompare(String(b[sortKey]));
      }
      // Stable, predictable tiebreak: name then voter ID.
      return (
        c * dir ||
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName) ||
        a.id - b.id
      );
    });
    return out;
  }, [matched, sortKey, asc]);

  // Any change to the result set can invalidate the current page number.
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageRows = useMemo(
    () => sorted.slice(page * pageSize, page * pageSize + pageSize),
    [sorted, page, pageSize],
  );

  const partyTally = useMemo(() => {
    const t = new Map<string, number>();
    for (const v of matched) t.set(v.party, (t.get(v.party) ?? 0) + 1);
    return [...t].sort((a, b) => b[1] - a[1]);
  }, [matched]);

  // --- Map inputs -----------------------------------------------------------
  // Built once from the dataset, never per filter change: the canvas layer
  // filters inside its draw loop off `mapMask`, so panning and zooming stay
  // cheap no matter what the filters are doing.
  // `type` is an index into `mapColors`: a party, or an early-voting status
  // when the map is coloured that way. Rebuilt on a colour-mode switch, which
  // is rare; filter changes only touch the mask.
  const colorByBallot = mapColorBy === "ballot" && liveElection !== null;
  const mapColors = useMemo(
    () =>
      colorByBallot
        ? BALLOT_STATUS_ORDER.map((s) => ballotStatusColor(s))
        : partyDomain.map(partyColor),
    [colorByBallot, partyDomain],
  );
  const mapPoints = useMemo<MappedVoter[]>(() => {
    const partyIndex = new Map(partyDomain.map((p, i) => [p, i]));
    const statusIndex = new Map(BALLOT_STATUS_ORDER.map((s, i) => [s, i]));
    const out: MappedVoter[] = [];
    for (const v of voters) {
      if (!isMapped(v)) continue;
      const type = colorByBallot
        ? (statusIndex.get(v.ballotStatus) ?? 0)
        : (partyIndex.get(v.party) ?? 0);
      out.push({ voter: v, lat: v.lat, lon: v.lon, type });
    }
    return out;
  }, [voters, partyDomain, colorByBallot]);

  /**
   * Which mapped voters survive the current search and filters, as a mask the
   * draw loop can read by index. null when nothing is filtered — that is the
   * case where the renderer gets to use its precomputed cluster pyramid.
   */
  const mapMask = useMemo(() => {
    if (matched.length === voters.length) return null;
    const keep = new Set<number>();
    for (const v of matched) keep.add(v.id);
    const mask = new Uint8Array(mapPoints.length);
    for (let i = 0; i < mapPoints.length; i++) {
      mask[i] = keep.has(mapPoints[i].voter.id) ? 1 : 0;
    }
    return mask;
  }, [matched, voters.length, mapPoints]);

  /** Voters currently matching that also have a coordinate. */
  const mappedMatched = useMemo(
    () => matched.reduce((n, v) => (isMapped(v) ? n + 1 : n), 0),
    [matched],
  );

  /**
   * Legend rows for the map — only over the dots actually drawn. Parties sort
   * by count; early-voting statuses keep their fixed voted / out / none order.
   */
  const mapLegend = useMemo(() => {
    const t = new Map<string, number>();
    for (const v of matched) {
      if (!isMapped(v)) continue;
      const k = colorByBallot ? v.ballotStatus : v.party;
      t.set(k, (t.get(k) ?? 0) + 1);
    }
    if (colorByBallot) {
      return BALLOT_STATUS_ORDER.filter((s) => t.has(s)).map((s) => ({
        code: s,
        label: ballotStatusLabel(s),
        color: ballotStatusColor(s),
        count: t.get(s) ?? 0,
        title: ballotStatusHelp(s),
      }));
    }
    return [...t]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        code,
        label: partyLabel(code),
        color: partyColor(code),
        count,
      }));
  }, [matched, colorByBallot]);

  const onSort = useCallback(
    (key: SortKey) => {
      setPage(0);
      if (key === sortKey) {
        setAsc((v) => !v);
      } else {
        setSortKey(key);
        setAsc(true);
      }
    },
    [sortKey],
  );

  const resetAll = () => {
    setDrills([]);
    setQuery("");
    setParties(new Set(partyDomain));
    setJurisdictions(new Set(jurisdictionDomain));
    setPrecincts(new Set(precinctDomain));
    setElections(new Set([...electionDomain, neverVoted]));
    setElectionMatch("any");
    setBallotStatuses(new Set(BALLOT_STATUS_ORDER));
    setPage(0);
  };

  /**
   * Jump from a voter's dialog to their dot. The map may not be mounted yet on
   * the first switch from the list, so retry briefly until MapController has
   * handed the instance over.
   */
  const showOnMap = (v: Voter) => {
    if (v.lat == null || v.lon == null) return;
    setSelected(null);
    setView("map");
    const lat = v.lat;
    const lon = v.lon;
    let tries = 0;
    const go = () => {
      const map = mapRef.current;
      if (map) {
        map.invalidateSize();
        map.setView([lat, lon], 18, { animate: false });
      } else if (tries++ < 40) {
        window.setTimeout(go, 50);
      }
    };
    window.setTimeout(go, 50);
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(sorted, electionDomain, liveElection !== null)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${COUNTY_NAME.toLowerCase()}-voters-${sorted.length}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Download an arbitrary table. Reports build their own rows; this only
   *  quotes and saves them. */
  const exportTable = (
    filename: string,
    header: string[],
    rows: (string | number)[][],
  ) => {
    const cell = (x: string | number) => {
      const t = String(x);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${COUNTY_NAME.toLowerCase()}-${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** What the reports print above every figure, so a filtered report can never
   *  be mistaken for a county-wide one. */
  const filterSummary = [
    query.trim() ? `search "${query.trim()}"` : "",
    parties.size !== partyDomain.length ? `${parties.size} of ${partyDomain.length} parties` : "",
    jurisdictions.size !== jurisdictionDomain.length
      ? `${jurisdictions.size} of ${jurisdictionDomain.length} jurisdictions`
      : "",
    precincts.size !== precinctDomain.length
      ? `${precincts.size} of ${precinctDomain.length} precincts`
      : "",
    elections.size !== electionFilterTotal || electionMatch !== "any"
      ? `${elections.size} of ${electionFilterTotal} elections (${electionMatch})`
      : "",
    liveElection && ballotStatuses.size !== ballotDomain.length
      ? `early voting: ${ballotDomain
          .filter((s) => ballotStatuses.has(s))
          .map((s) => ballotStatusLabel(s).toLowerCase())
          .join(" / ") || "none"}`
      : "",
    ...drills.map((d) => d.label),
  ]
    .filter(Boolean)
    .join(", ");

  const filtersActive =
    query.trim() !== "" ||
    parties.size !== partyDomain.length ||
    jurisdictions.size !== jurisdictionDomain.length ||
    precincts.size !== precinctDomain.length ||
    elections.size !== electionFilterTotal ||
    electionMatch !== "any" ||
    (liveElection !== null && ballotStatuses.size !== ballotDomain.length) ||
    drills.length > 0;

  /**
   * A count was clicked: narrow to the voters behind it and show them in the
   * list. Every count in the app goes through here except the map legend,
   * which narrows the dots in place.
   */
  const drillToList = (label: string, predicate: (v: Voter) => boolean) => {
    addDrill(label, predicate);
    setView("list");
  };

  /** "2026 General" -> "2026 General (early voting through Oct 16)". */
  const electionHeading = (e: VoterMeta["elections"][number]) =>
    isProvisional(e) && e.asOf
      ? `${e.label} (early voting through ${formatDate(e.asOf)})`
      : e.label;

  return (
    <>
      <div id="header">
        <div className="header-left">
          <MainMenu
            view={view}
            onViewChange={setView}
            baseMap={baseMap}
            onSetBaseMap={setBaseMap}
            onExportCsv={exportCsv}
            exportDisabled={sorted.length === 0}
            onReset={resetAll}
            resetDisabled={!filtersActive}
            onOpenHelp={() => setHelpOpen(true)}
          />
          <div className="title-block">
            <h1>{COUNTY_NAME.toUpperCase()} COUNTY VOTERS</h1>
            <p>
              {/* Naming every election costs four lines on a phone once
                  there are more than a handful, so a narrow screen gets the
                  range instead. CSS picks one. */}
              <span className="subtitle-full">
                {meta && meta.elections.length
                  ? `${meta.count.toLocaleString()} registered voters and their voting history, from the Ohio Secretary of State's ${COUNTY_NAME} County voter file — ${meta.elections
                      .map(electionHeading)
                      .join(", ")}`
                  : `Registered voters and voting history from the Ohio Secretary of State's ${COUNTY_NAME} County voter file`}
              </span>
              <span className="subtitle-short">
                {meta && meta.elections.length
                  ? `${meta.elections.length} elections · ${meta.elections[0].label} – ${
                      meta.elections[meta.elections.length - 1].label
                    }`
                  : `Ohio Secretary of State · ${COUNTY_NAME} County`}
              </span>
            </p>
          </div>
        </div>
        <div className="meta">
          {/* Reports are the app's most useful view and were three clicks
              deep in the main menu; this puts them one click away from every
              view. In Reports it becomes the way back to the list. */}
          <button
            id="reports-btn"
            className={view === "reports" ? "active" : ""}
            onClick={() => setView(view === "reports" ? "list" : "reports")}
            title={view === "reports" ? "Back to the voter list" : "Turnout, retention, participation, geography and early-voting reports for the voters the filters select"}
            aria-pressed={view === "reports"}
          >
            {view === "reports" ? "\u2190 Voter list" : "\u{1F4CA} Reports"}
          </button>
          <button
            id="help-btn"
            onClick={() => setHelpOpen(true)}
            title="About this app"
            aria-label="About this app"
          >
            ?
          </button>
          <span className="meta-credit">
            Records: <span>{voters.length.toLocaleString()}</span>
            {meta ? ` · Export run ${meta.runDate}` : ""}
          </span>
        </div>
      </div>

      {/* Fifteen counts fill half a phone screen before any data shows, so
          below the breakpoint everything after the first two collapses behind
          the toggle. `.stats-more` is display:contents on a wide screen, so
          the flex row is laid out exactly as it was. */}
      <div id="stats-bar" className={statsOpen ? "open" : ""}>
        <div className="stat">
          Matching:{" "}
          <b>
            <CountLink
              title={`Show the ${matched.length.toLocaleString()} matching voters in the list`}
              onClick={() => setView("list")}
            >
              {matched.length.toLocaleString()}
            </CountLink>
          </b>
        </div>
        <div className="stat">
          On map:{" "}
          <b>
            <CountLink
              title={`Show the ${mappedMatched.toLocaleString()} matching voters who are placed on the map`}
              onClick={() => drillToList("placed on the map", isMapped)}
            >
              {mappedMatched.toLocaleString()}
            </CountLink>
          </b>
        </div>
        <div className="stats-more">
          {(meta?.elections ?? []).map((e, i) => {
            const n = matched
              .reduce((t, v) => (v.electionMask & (1 << i) ? t + 1 : t), 0)
              .toLocaleString();
            const live = isProvisional(e);
            return (
              <div className="stat" key={e.id}>
                {e.label}
                {e.countyWide ? "" : "*"}
                {live ? " (early)" : ""}:{" "}
                <b>
                  <CountLink
                    title={
                      live
                        ? `Show the ${n} voters whose ${e.label} ballot is back`
                        : `Show the ${n} voters who voted in ${e.label}`
                    }
                    onClick={() =>
                      drillToList(
                        live ? "voted early" : `voted in ${e.label}`,
                        (v) => (v.electionMask & (1 << i)) !== 0,
                      )
                    }
                  >
                    {n}
                  </CountLink>
                </b>
              </div>
            );
          })}
          {liveElection && (
            <div className="stat" title="Ballots issued and not yet returned">
              Ballots out:{" "}
              <b>
                <CountLink
                  title="Show the voters whose ballot is issued and not yet back"
                  onClick={() =>
                    drillToList("ballot still out", (v) => v.ballotStatus === "out")
                  }
                >
                  {matched
                    .reduce((n, v) => (v.ballotStatus === "out" ? n + 1 : n), 0)
                    .toLocaleString()}
                </CountLink>
              </b>
            </div>
          )}
          {partyTally.map(([code, n]) => (
            <div className="stat" key={code}>
              <span
                className="party-dot"
                style={{ background: partyColor(code) }}
              />
              {partyLabel(code)}:{" "}
              <b>
                <CountLink
                  title={`Show the ${n.toLocaleString()} ${partyLabel(code)} voters`}
                  onClick={() =>
                    drillToList(`${partyLabel(code)} voters`, (v) => v.party === code)
                  }
                >
                  {n.toLocaleString()}
                </CountLink>
              </b>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="stats-toggle"
          onClick={() => setStatsOpen((o) => !o)}
          aria-expanded={statsOpen}
        >
          {statsOpen ? "Fewer counts ▲" : "All counts ▼"}
        </button>
      </div>

      <div id="search-bar">
        <div className="search-wrap">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search name, voter ID, street, city, ZIP or precinct…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                // Stop it bubbling to anything else listening for Escape.
                e.preventDefault();
                clearSearch();
              }
            }}
            aria-label="Search voters"
          />
          {query && (
            <button
              className="search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
              title="Clear search (Esc)"
            >
              ×
            </button>
          )}
        </div>
        <MultiSelectFilter
          label="Elections"
          noun="elections"
          options={electionOptions}
          selected={elections}
          onChange={(s) => {
            setElections(s);
            setPage(0);
          }}
          renderName={(label) => {
            const e = meta?.elections.find((x) => x.label === label);
            if (e && isProvisional(e)) {
              return (
                <>
                  {label} <span className="scope-tag live-tag">in progress</span>
                </>
              );
            }
            if (label === neverVoted) {
              return (
                <>
                  {label} <span className="scope-tag">registered, no ballot</span>
                </>
              );
            }
            return e && !e.countyWide ? (
              <>
                {label} <span className="scope-tag">part of county</span>
              </>
            ) : (
              label
            );
          }}
          panelHeader={
            <ElectionMatchToggle
              value={electionMatch}
              onChange={(m) => {
                setElectionMatch(m);
                setPage(0);
              }}
              selectedCount={elections.size - (elections.has(neverVoted) ? 1 : 0)}
            />
          }
        />
        <MultiSelectFilter
          label="Party"
          noun="parties"
          options={partyOptions}
          selected={parties}
          onChange={(s) => {
            setParties(s);
            setPage(0);
          }}
          renderName={(code) => partyLabel(code)}
          summaryName={partyLabel}
        />
        <MultiSelectFilter
          label="Jurisdiction"
          noun="jurisdictions"
          options={jurisdictionOptions}
          selected={jurisdictions}
          onChange={(s) => {
            setJurisdictions(s);
            setPage(0);
          }}
          searchable
        />
        <MultiSelectFilter
          label="Precinct"
          noun="precincts"
          options={precinctOptions}
          selected={precincts}
          onChange={(s) => {
            setPrecincts(s);
            setPage(0);
          }}
          searchable
        />
        {liveElection && (
          <MultiSelectFilter
            label="Early voting"
            noun="statuses"
            options={ballotOptions}
            selected={ballotStatuses}
            onChange={(s) => {
              setBallotStatuses(s);
              setPage(0);
            }}
            renderName={(s) => (
              <>
                <span
                  className="party-dot"
                  style={{ background: ballotStatusColor(s) }}
                />{" "}
                {ballotStatusLabel(s)}
              </>
            )}
            summaryName={ballotStatusLabel}
            title={`Where each voter stands in the ${liveElection.label}, from the Board of Elections' absentee file through ${formatDate(liveElection.asOf ?? "")}`}
            optionTitle={ballotStatusHelp}
            panelHeader={
              <div className="ballot-panel-head">
                <b>{liveElection.label}</b> — ballots through{" "}
                {formatDate(liveElection.asOf ?? "")}
                {liveElection.electionDate
                  ? `; election day ${formatDate(liveElection.electionDate)}`
                  : ""}
                .
              </div>
            }
          />
        )}
        {/* Clears the search, every dropdown and every chip. Lives beside the
            controls it clears, on every view; the menu's Reset does the same. */}
        {filtersActive && (
          <button
            type="button"
            className="clear-filters"
            onClick={resetAll}
            title="Clear the search, every filter and every chip"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Every drill applied, in the order they were clicked. Lives under the
          filter bar rather than in the list caption so it shows on the map
          and the reports too - all three describe the same narrowed set. */}
      {drills.length > 0 && (
        <div id="drill-bar" role="region" aria-label="Narrowed to">
          <span className="drill-bar-label">Narrowed to</span>
          {drills.map((d) => (
            <span className="caption-drill" key={d.label}>
              {d.label}
              <button
                type="button"
                onClick={() => removeDrill(d.label)}
                aria-label={`Remove: ${d.label}`}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
          {drills.length > 1 && (
            <button type="button" className="link-btn" onClick={() => setDrills([])}>
              Clear all
            </button>
          )}
        </div>
      )}

      {loading || error ? (
        <div id="state-msg">
          {error ? (
            <>
              <div className="err">Couldn't load the voter data.</div>
              <div>{error}</div>
            </>
          ) : (
            <div>Loading voter records…</div>
          )}
        </div>
      ) : view === "reports" ? (
        <ReportsView
          voters={matched}
          totalVoters={voters.length}
          elections={meta?.elections ?? []}
          filterSummary={filterSummary}
          onClearFilters={resetAll}
          onDrill={drillToList}
          onExportCsv={exportTable}
        />
      ) : view === "map" ? (
        <VoterMap
          baseMap={baseMap}
          points={mapPoints}
          colors={mapColors}
          mask={mapMask}
          legend={mapLegend}
          colorBy={colorByBallot ? "ballot" : "party"}
          onColorBy={liveElection ? setMapColorBy : undefined}
          onPickLegend={(code) =>
            colorByBallot
              ? addDrill(
                  code === "voted"
                    ? "voted early"
                    : code === "out"
                      ? "ballot still out"
                      : "no ballot yet",
                  (v) => v.ballotStatus === code,
                )
              : addDrill(`${partyLabel(code)} voters`, (v) => v.party === code)
          }
          onSelect={setSelected}
          onMapReady={(m) => {
            mapRef.current = m;
          }}
        />
      ) : (
        <div id="account-table-wrap">
          <div className="table-caption">
            <span>
              {matched.length === 0
                ? "No voters match the current search and filters."
                : `${matched.length.toLocaleString()} voter${
                    matched.length === 1 ? "" : "s"
                  } of ${voters.length.toLocaleString()}`}
            </span>
            {matched.length > 0 && (
              <span className="caption-hint">Click a row for full details.</span>
            )}
            {matched.length > mappedMatched && (
              <span className="caption-note">
                {(matched.length - mappedMatched).toLocaleString()} not on the
                map — no address match
              </span>
            )}
          </div>
          <VoterTable
            rows={pageRows}
            sortKey={sortKey}
            asc={asc}
            onSort={onSort}
            onSelect={setSelected}
            showBallot={liveElection !== null}
          />
          <Pager
            total={sorted.length}
            page={Math.min(page, pageCount - 1)}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(0);
            }}
          />
        </div>
      )}

      <BuildStamp />

      <VoterDialog
        voter={selected}
        onClose={() => setSelected(null)}
        onShowOnMap={view === "list" ? showOnMap : undefined}
        onSuggestEdit={(v) => {
          setSelected(null);
          setEditVoter(v);
        }}
        allElections={electionDomain}
        liveElection={liveElection}
      />
      <SuggestEditDialog voter={editVoter} onClose={() => setEditVoter(null)} />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
