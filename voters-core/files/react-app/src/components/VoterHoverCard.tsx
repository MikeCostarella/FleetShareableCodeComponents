import {
  ballotStatusColor,
  ballotStatusLabel,
  formatDate,
  fullName,
  partyColor,
  partyLabel,
} from "../types/voter";
import type { HoverInfo } from "./VoterCanvasLayer";

/**
 * Small card that follows the cursor over the map: the voter under a dot, or
 * how many voters are inside a cluster. Positioned in container pixels, and
 * flipped to the other side of the cursor near the right or bottom edge.
 */
export default function VoterHoverCard({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return null;

  const flipX = hover.x > window.innerWidth - 260;
  const flipY = hover.y > window.innerHeight - 140;
  const style: React.CSSProperties = {
    left: flipX ? undefined : hover.x + 16,
    right: flipX ? window.innerWidth - hover.x + 16 : undefined,
    top: flipY ? undefined : hover.y + 16,
    bottom: flipY ? window.innerHeight - hover.y + 16 : undefined,
  };

  if (hover.kind === "cluster") {
    return (
      <div className="hover-card" style={style}>
        <b>{hover.count.toLocaleString()}</b> voter{hover.count === 1 ? "" : "s"}
        <div className="hover-hint">Click to zoom in</div>
      </div>
    );
  }

  const v = hover.voter;
  return (
    <div className="hover-card" style={style}>
      <div className="hover-name">{fullName(v)}</div>
      <div className="hover-line">{v.street}</div>
      <div className="hover-line">
        {v.city}, {v.state} {v.zip}
      </div>
      <div className="hover-line">
        <span className="party-dot" style={{ background: partyColor(v.party) }} />
        {partyLabel(v.party)} · {v.precinct}
      </div>
      {v.ballot && (
        <div className="hover-line">
          <span
            className="party-dot"
            style={{ background: ballotStatusColor(v.ballotStatus) }}
          />
          {ballotStatusLabel(v.ballotStatus)}
          {v.ballotStatus === "voted"
            ? ` · ${formatDate(v.ballot.returned)}`
            : ` · issued ${formatDate(v.ballot.issued)}`}
        </div>
      )}
      <div className="hover-hint">Click for details</div>
    </div>
  );
}
