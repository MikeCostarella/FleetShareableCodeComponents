import { useState } from "react";
import CountLink from "./CountLink";
import type { BoundaryVisibility } from "./BoundaryLayers";
import type { MapColorBy } from "./VoterMap";

/** One swatch line in the legend: a party, or an early-voting status. */
export interface LegendRow {
  code: string;
  label: string;
  color: string;
  count: number;
  /** Optional hover text explaining the row. */
  title?: string;
}

interface MapLegendProps {
  /** Swatch rows for the current colouring, with counts over the result set. */
  rows: LegendRow[];
  colorBy: MapColorBy;
  /** Present only while an early-voting colouring is available. */
  onColorBy?: (next: MapColorBy) => void;
  visible: BoundaryVisibility;
  onToggle: (next: BoundaryVisibility) => void;
  /** Makes each count a link that narrows the map to that row's voters. */
  onPick?: (code: string) => void;
}

const BOUNDARY_ROWS: {
  id: keyof BoundaryVisibility;
  label: string;
  color: string;
  dash: string;
}[] = [
  { id: "municipalities", label: "Municipalities", color: "#FF8F00", dash: "8,5" },
  { id: "townships", label: "Townships", color: "#607d8b", dash: "" },
  { id: "precincts", label: "Precincts", color: "#5bc4f5", dash: "3,4" },
];

/**
 * Collapsible bottom-right key: the dot colours plus the boundary toggles.
 * During early voting a two-way switch above the swatches picks whether the
 * dots show party or ballot status.
 */
export default function MapLegend({
  rows,
  colorBy,
  onColorBy,
  visible,
  onToggle,
  onPick,
}: MapLegendProps) {
  // Open on a desktop, closed on a phone: expanded it covers most of a 390px
  // map. Read once on mount - this decides an initial state, not a live
  // response to resizing, and the user's toggle must win afterwards.
  const [open, setOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 640,
  );

  return (
    <div id="legend">
      <div
        id="legend-header"
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <span>Legend</span>
        <span>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div id="legend-body">
          {onColorBy && (
            <div className="legend-colorby">
              <span className="match-toggle-label">Colour by</span>
              <div className="match-seg" role="radiogroup" aria-label="Colour dots by">
                <button
                  type="button"
                  role="radio"
                  aria-checked={colorBy === "party"}
                  className={colorBy === "party" ? "active" : ""}
                  onClick={() => onColorBy("party")}
                >
                  party
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={colorBy === "ballot"}
                  className={colorBy === "ballot" ? "active" : ""}
                  onClick={() => onColorBy("ballot")}
                >
                  early voting
                </button>
              </div>
            </div>
          )}
          {rows.map((r) => (
            <div className="legend-row" key={r.code} title={r.title}>
              <span className="legend-dot" style={{ background: r.color }} />
              <span className="legend-name">{r.label}</span>
              <span className="legend-count">
                {onPick ? (
                  <CountLink
                    title={`Narrow the map to the ${r.count.toLocaleString()} ${r.label} voters`}
                    onClick={() => onPick(r.code)}
                  >
                    {r.count.toLocaleString()}
                  </CountLink>
                ) : (
                  r.count.toLocaleString()
                )}
              </span>
            </div>
          ))}

          <div className="legend-subhead">Boundaries</div>
          {BOUNDARY_ROWS.map((b) => (
            <label className="legend-toggle-row" key={b.id}>
              <input
                type="checkbox"
                checked={visible[b.id]}
                onChange={(e) => onToggle({ ...visible, [b.id]: e.target.checked })}
              />
              <span
                className="legend-line"
                style={{
                  borderTopColor: b.color,
                  borderTopStyle: b.dash ? "dashed" : "solid",
                }}
              />
              <span>{b.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
