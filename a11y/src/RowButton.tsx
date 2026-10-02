import type { ReactNode } from "react";

interface RowButtonProps {
  /** Opens the row's detail dialog: the same handler the map marker uses. */
  onActivate: () => void;
  /** Usually the row's name or ID cell content. */
  children: ReactNode;
  /** Accessible name when the visible text alone is unclear,
   *  e.g. "Warren Family Clinic, Pharmacy. View details". */
  label?: string;
  className?: string;
}

/**
 * The keyboard and screen-reader way into a table row. Put it in the row's
 * first cell around the name or ID. It is a real <button> styled to look like
 * the plain cell text, so the table keeps its row and cell semantics (unlike
 * role="button" on the <tr>) and the mouse-friendly <tr onClick> can stay.
 * Clicks on it don't bubble, so the row handler doesn't fire twice.
 */
export default function RowButton({ onActivate, children, label, className }: RowButtonProps) {
  return (
    <button
      type="button"
      className={className ? `a11y-row-btn ${className}` : "a11y-row-btn"}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
    >
      {children}
    </button>
  );
}
