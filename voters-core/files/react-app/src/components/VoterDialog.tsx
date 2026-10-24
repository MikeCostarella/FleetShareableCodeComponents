import { useEffect, useState } from "react";
import { COUNTY_NAME } from "../config/county";
import type { Election, Voter } from "../types/voter";
import { GEO_TIERS } from "../types/voter";
import {
  formatDate,
  fullAddress,
  fullName,
  isMapped,
  isProvisional,
  partyColor,
  partyLabel,
} from "../types/voter";
import BallotPill from "./BallotPill";

interface VoterDialogProps {
  voter: Voter | null;
  onClose: () => void;
  /** Switches to the map view and flies to this voter. Absent on the map. */
  onShowOnMap?: (v: Voter) => void;
  /** Opens the "Suggest an Edit" form for this voter. */
  onSuggestEdit?: (v: Voter) => void;
  /**
   * Every election in the dataset, newest first. The history panel needs the
   * full list so it can show the elections this voter sat out, not just the
   * ones they turned up for.
   */
  allElections?: string[];
  /** The election in progress, if the absentee file is merged in. */
  liveElection?: Election | null;
}

/** Detail card for one voter: registration facts plus address map links. */
export default function VoterDialog({
  voter,
  onClose,
  onShowOnMap,
  onSuggestEdit,
  allElections = [],
  liveElection = null,
}: VoterDialogProps) {
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Escape closes the dialog, matching the filter panels.
  useEffect(() => {
    if (!voter) return;
    setCopied(false);
    setHistoryOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [voter, onClose]);

  if (!voter) return null;

  const address = fullAddress(voter);
  const q = encodeURIComponent(address);

  // `voter.elections` is chronological, so the last entry is the newest.
  const mostRecent = voter.elections[voter.elections.length - 1] ?? "";
  /**
   * Every election on file, newest first, flagged with whether they voted and
   * whether they could. A Cortland-only special is not a missed election for
   * someone in Warren, and saying "did not vote" there would be wrong.
   */
  const liveLabel = liveElection && isProvisional(liveElection) ? liveElection.label : null;
  const history = (allElections.length ? allElections : voter.elections)
    .map((label, i) => ({
      label,
      voted: (voter.electionMask & (1 << i)) !== 0,
      eligible: (voter.eligibleMask & (1 << i)) !== 0,
      // The election still being voted: "not yet" is the only honest reading
      // of an unset bit, and it must not count as a missed election.
      live: label === liveLabel,
    }))
    .reverse();
  const eligibleCount = history.filter((h) => h.eligible).length;
  /** What the live election's row says instead of "Did not vote". */
  const liveState = (h: { voted: boolean }) =>
    h.voted
      ? "Voted early"
      : voter.ballotStatus === "out"
        ? "Ballot out, not yet returned"
        : "Not yet voted";

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / denied) — ignore */
    }
  };

  return (
    <div
      id="dialog-overlay"
      className="active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="dialog" role="dialog" aria-modal="true" aria-label="Voter details">
        <div id="dialog-header">
          <h2>{fullName(voter)}</h2>
          <button id="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div id="dialog-body">
          <div className="acct-card">
            <div className="acct-num">Voter #{voter.id}</div>
            <div className="acct-row">
              <span className="label">Party</span>
              <span className="party-pill">
                <span
                  className="party-dot"
                  style={{ background: partyColor(voter.party) }}
                />
                {partyLabel(voter.party)}
              </span>
            </div>
            <div className="acct-row">
              <span className="label">Registered</span>
              <span>{formatDate(voter.registered)}</span>
            </div>
            <div className="acct-row">
              <span className="label">Precinct</span>
              <span>{voter.precinct || "—"}</span>
            </div>
            {liveLabel && (
              <div className="acct-row">
                <span className="label">{liveLabel}</span>
                <BallotPill voter={voter} detailed />
              </div>
            )}
          </div>

          <div className="acct-card">
            <div className="acct-num">Address</div>
            <div className="acct-row">
              <span className="label">Street</span>
              <span>{voter.street}</span>
            </div>
            <div className="acct-row">
              <span className="label">City</span>
              <span>
                {voter.city}, {voter.state} {voter.zip}
              </span>
            </div>
            <div className="acct-row">
              <span className="label">Jurisdiction</span>
              <span>{voter.jurisdiction}</span>
            </div>
            <div className="btn-row">
              <a
                className="map-btn btn-gmap"
                href={`https://www.google.com/maps/search/?api=1&query=${q}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps
              </a>
              <a
                className="map-btn btn-dir"
                href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions
              </a>
              <button className="map-btn btn-copy" onClick={copyAddress}>
                {copied ? "Copied" : "Copy address"}
              </button>
              {onShowOnMap && isMapped(voter) && (
                <button
                  className="map-btn btn-onmap"
                  onClick={() => onShowOnMap(voter)}
                >
                  Show on map
                </button>
              )}
            </div>
          </div>

          <div className="acct-card">
            <div className="acct-row">
              <span className="label">Voted in</span>
              <span className="vote-badges">
                {mostRecent ? (
                  <span className="vote-badge">{mostRecent}</span>
                ) : (
                  "—"
                )}
                {allElections.length > 1 && (
                  <button
                    className="history-btn"
                    onClick={() => setHistoryOpen((o) => !o)}
                    aria-expanded={historyOpen}
                  >
                    {historyOpen ? "Hide history" : "Voting history"}
                    <span className="history-caret">{historyOpen ? "▴" : "▾"}</span>
                  </button>
                )}
              </span>
            </div>
            {historyOpen && (
              <div className="vote-history">
                <div className="vote-history-head">
                  Voted in <b>{voter.elections.length}</b> of{" "}
                  <b>{eligibleCount}</b> election{eligibleCount === 1 ? "" : "s"}{" "}
                  they could vote in
                  {eligibleCount < history.length &&
                    ` (${history.length} on file)`}
                </div>
                {history.map((h) => (
                  <div
                    className={`vote-history-row${h.voted ? " voted" : ""}${
                      h.eligible || h.live ? "" : " ineligible"
                    }${h.live && !h.voted ? " live" : ""}`}
                    key={h.label}
                  >
                    <span className="vote-history-mark" aria-hidden="true">
                      {h.voted ? "\u2713" : h.live ? "\u2026" : h.eligible ? "\u00b7" : "\u2013"}
                    </span>
                    <span className="vote-history-label">
                      {h.label}
                      {h.live && <span className="scope-tag live-tag"> in progress</span>}
                    </span>
                    <span className="vote-history-state">
                      {h.live
                        ? liveState(h)
                        : h.voted
                          ? "Voted"
                          : h.eligible
                            ? "Did not vote"
                            : "Not eligible"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="acct-row">
              <span className="label">Source</span>
              <span>
                {voter.ballot?.fromAbsenteeFile
                  ? "Board of Elections absentee file (mailing address; no registration date)"
                  : `Ohio Secretary of State voter file (${COUNTY_NAME} County)`}
              </span>
            </div>
            <div className="acct-row">
              <span className="label">Map position</span>
              <span>{GEO_TIERS[voter.geo] ?? "Not placed"}</span>
            </div>
            {onSuggestEdit && (
              <div className="btn-row">
                <button
                  className="map-btn btn-edit"
                  onClick={() => onSuggestEdit(voter)}
                >
                  &#9998; Suggest an Edit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
