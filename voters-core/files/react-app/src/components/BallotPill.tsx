import type { Voter } from "../types/voter";
import {
  ballotCategoryLabel,
  ballotStatusColor,
  ballotStatusLabel,
  formatDate,
} from "../types/voter";

interface BallotPillProps {
  voter: Voter;
  /** Add the category and dates after the status (the voter dialog). */
  detailed?: boolean;
}

/**
 * One voter's standing in the election in progress, as a coloured pill:
 * "Voted early · Oct 14", "Ballot out · issued Oct 6", or a quiet dash for
 * someone the absentee file does not mention. The dash is deliberately not
 * the words "did not vote" - during early voting that is not known yet.
 */
export default function BallotPill({ voter, detailed = false }: BallotPillProps) {
  const { ballot, ballotStatus } = voter;
  if (!ballot) {
    return <span className="ballot-none" title="No early or absentee ballot on file yet">—</span>;
  }
  const when =
    ballotStatus === "voted"
      ? formatDate(ballot.returned)
      : ballot.issued
        ? `issued ${formatDate(ballot.issued)}`
        : "not sent yet";
  // A returned ballot the Board has flagged (no signature, ID envelope
  // problem): still returned, but the voter has something to cure, and the
  // pill must not read as settled.
  const issue = ballot.issue ? ballot.issue.toLowerCase() : "";
  const title = [ballotCategoryLabel(ballot.category), issue && `Board flagged: ${issue}`]
    .filter(Boolean)
    .join(" — ");
  return (
    <span className="party-pill ballot-pill" title={title}>
      <span className="party-dot" style={{ background: ballotStatusColor(ballotStatus) }} />
      {ballotStatusLabel(ballotStatus)}
      <span className="ballot-when"> · {when}</span>
      {issue && <span className="ballot-when"> · ⚠ {issue}</span>}
      {detailed && (
        <span className="ballot-when"> · {ballotCategoryLabel(ballot.category)}</span>
      )}
    </span>
  );
}
