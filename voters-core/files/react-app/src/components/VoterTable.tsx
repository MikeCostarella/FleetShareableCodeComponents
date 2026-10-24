import type { Voter } from "../types/voter";
import { formatDate, partyColor, partyLabel } from "../types/voter";
import BallotPill from "./BallotPill";

export type SortKey =
  | "lastName"
  | "firstName"
  | "id"
  | "precinct"
  | "street"
  | "city"
  | "jurisdiction"
  | "registered"
  | "party"
  | "elections"
  | "ballot";

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  /** Shown on hover when the sort does something non-obvious. */
  hint?: string;
}

export const COLUMNS: Column[] = [
  { key: "lastName", label: "Last Name" },
  { key: "firstName", label: "First / Middle" },
  { key: "id", label: "Voter ID", numeric: true },
  { key: "precinct", label: "Precinct" },
  { key: "street", label: "Street", hint: "Sorts by street name, then house number" },
  { key: "city", label: "City" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "registered", label: "Registered" },
  { key: "party", label: "Party" },
  { key: "elections", label: "Voted In" },
];

/** Added after Voted In while the dataset carries an election in progress. */
const BALLOT_COLUMN: Column = {
  key: "ballot",
  label: "Early Voting",
  hint: "Voted early first, then ballots still out, newest movement first",
};

interface VoterTableProps {
  /** The rows for the CURRENT page only — already filtered and sorted. */
  rows: Voter[];
  sortKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  onSelect: (v: Voter) => void;
  /** Show the Early Voting column (only while an election is in progress). */
  showBallot?: boolean;
}

/**
 * Sortable, sticky-header table of voters. Sorting and paging are owned by App
 * so the header click can reset the page; this component only renders.
 *
 * On a phone the same markup becomes a list of cards: the head row is hidden
 * and every cell labels itself from `data-label`, which is why each `<td>`
 * carries one. Ten columns cannot be read 390px at a time, and a table that
 * wide drags the whole page sideways when it is swiped. The sort control below
 * replaces the column headers that the card layout hides.
 */
export default function VoterTable({
  rows,
  sortKey,
  asc,
  onSort,
  onSelect,
  showBallot = false,
}: VoterTableProps) {
  const columns = showBallot ? [...COLUMNS, BALLOT_COLUMN] : COLUMNS;
  return (
    <>
      <div className="card-sort">
        <label htmlFor="card-sort-key">Sort</label>
        <select
          id="card-sort-key"
          value={sortKey}
          onChange={(e) => onSort(e.target.value as SortKey)}
        >
          {columns.map((col) => (
            <option key={col.key} value={col.key}>
              {col.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={asc ? "Sort descending" : "Sort ascending"}
          title={asc ? "Sort descending" : "Sort ascending"}
        >
          {asc ? "▲" : "▼"}
        </button>
      </div>
      <div className="table-scroll">
      <table id="account-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.numeric ? "num" : ""}${
                  sortKey === col.key ? " sorted" : ""
                }`}
                onClick={() => onSort(col.key)}
                title={col.hint}
                aria-sort={
                  sortKey === col.key
                    ? asc
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                {col.label}
                <span className="sort-caret">
                  {sortKey === col.key ? (asc ? " ▲" : " ▼") : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={columns.length}>
                No voters match the current search and filters.
              </td>
            </tr>
          ) : (
            rows.map((v) => (
              <tr key={v.id} onClick={() => onSelect(v)}>
                <td data-label="Last Name">{v.lastName}</td>
                <td data-label="First / Middle">{v.firstName || "—"}</td>
                <td className="num" data-label="Voter ID">{v.id}</td>
                <td data-label="Precinct">{v.precinct}</td>
                <td data-label="Street">{v.street}</td>
                <td data-label="City">{v.city}</td>
                <td data-label="Jurisdiction">{v.jurisdiction}</td>
                <td data-label="Registered">{formatDate(v.registered)}</td>
                <td data-label="Party">
                  <span className="party-pill">
                    <span
                      className="party-dot"
                      style={{ background: partyColor(v.party) }}
                    />
                    {partyLabel(v.party)}
                  </span>
                </td>
                <td data-label="Voted In">
                  {v.elections.length === 0 ? (
                    "—"
                  ) : (
                    <span className="vote-badges">
                      {v.elections.map((e) => (
                        <span className="vote-badge" key={e}>
                          {e}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                {showBallot && (
                  <td data-label="Early Voting">
                    <BallotPill voter={v} />
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </>
  );
}
