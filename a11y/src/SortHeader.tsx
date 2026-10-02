import type { ReactNode } from "react";
import type { AriaSort } from "./a11y";

interface SortHeaderProps {
  /** Visible column label. */
  children: ReactNode;
  /** From ariaSortFor(column, activeKey, ascending). */
  sort: AriaSort;
  onSort: () => void;
  /** Class for the <th> (the app's existing header class). */
  className?: string;
  /** Class for the inner button. Defaults to the shared "a11y-sort-btn". */
  buttonClassName?: string;
  /** Caret glyphs. Decorative: aria-sort already tells screen readers. */
  carets?: { ascending: string; descending: string };
  /** Class for the caret span (e.g. the app's existing "sort-arrow"). */
  caretClassName?: string;
}

/**
 * Sortable column header that works from the keyboard. The <th> keeps
 * scope="col" and aria-sort; the click target is a real <button> inside it,
 * so Tab reaches it and Enter/Space sort (WCAG 2.1.1). Replaces the fleet's
 * <th onClick> pattern, which only a mouse could use.
 */
export default function SortHeader({
  children,
  sort,
  onSort,
  className,
  buttonClassName = "a11y-sort-btn",
  carets = { ascending: " \u25B2", descending: " \u25BC" },
  caretClassName,
}: SortHeaderProps) {
  return (
    <th scope="col" className={className} aria-sort={sort}>
      <button type="button" className={buttonClassName} onClick={onSort}>
        {children}
        <span className={caretClassName} aria-hidden="true">
          {sort === "ascending" ? carets.ascending : sort === "descending" ? carets.descending : ""}
        </span>
      </button>
    </th>
  );
}
