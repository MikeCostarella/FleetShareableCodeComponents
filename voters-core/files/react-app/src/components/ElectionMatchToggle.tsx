import type { ElectionMatch } from "../types/voter";

interface ElectionMatchToggleProps {
  value: ElectionMatch;
  onChange: (next: ElectionMatch) => void;
  /** How many elections are ticked, to word the explanation. */
  selectedCount: number;
}

/**
 * The any/all switch that sits above the election list.
 *
 * With two elections on file the distinction is the whole point of merging
 * them: "any" is everyone who turned out at least once, "all" is the people who
 * turned out every time. The line underneath spells out which question the
 * current setting is asking, because "any/all" on its own reads as jargon.
 */
export default function ElectionMatchToggle({
  value,
  onChange,
  selectedCount,
}: ElectionMatchToggleProps) {
  return (
    <div className="match-toggle">
      <div className="match-toggle-row">
        <span className="match-toggle-label">Voted in</span>
        <div className="match-seg" role="radiogroup" aria-label="Election match mode">
          <button
            type="button"
            role="radio"
            aria-checked={value === "any"}
            className={value === "any" ? "active" : ""}
            onClick={() => onChange("any")}
          >
            any
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={value === "all"}
            className={value === "all" ? "active" : ""}
            onClick={() => onChange("all")}
          >
            all
          </button>
        </div>
      </div>
      <div className="match-toggle-hint">
        {selectedCount === 0
          ? "Tick at least one election."
          : value === "any"
            ? selectedCount === 1
              ? "Voters who cast a ballot in that election."
              : "Voters who cast a ballot in at least one of them."
            : selectedCount === 1
              ? "Voters who cast a ballot in that election."
              : "Only voters who cast a ballot in every one of them they were eligible for."}
      </div>
    </div>
  );
}
