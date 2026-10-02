// Pure helpers behind the a11y components and hooks. No DOM, no React, so the
// library's suite (a11y/test/) can run them in plain Node.
//
// Target: WCAG 2.1 Level AA, the standard named by the DOJ ADA Title II web
// rule and the HHS Section 504 rule. The fleet's map apps conform through a
// "conforming alternate version": the list view must do everything the map
// does, by keyboard and screen reader. These helpers serve that list view.

export type AriaSort = "ascending" | "descending" | "none";

/** aria-sort value for a column, given the active sort key and direction. */
export function ariaSortFor<K extends string>(
  column: K,
  activeKey: K | null | undefined,
  ascending: boolean,
): AriaSort {
  if (activeKey !== column) return "none";
  return ascending ? "ascending" : "descending";
}

/**
 * Screen-reader sentence for a result count: "34 providers", "1 provider",
 * "No providers match". `of` adds the unfiltered total: "34 of 120 providers".
 * Numbers use the viewer's locale grouping (99,728).
 */
export function countMessage(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
  of?: number,
): string {
  if (count === 0) return `No ${plural} match`;
  const noun = count === 1 ? singular : plural;
  const n = count.toLocaleString("en-US");
  if (of !== undefined && of !== count) {
    return `${n} of ${of.toLocaleString("en-US")} ${plural}`;
  }
  return `${n} ${noun}`;
}

/**
 * Read the initial view from a query string (`?view=list`). Lets anyone be
 * handed a link that opens straight into the accessible list view. Unknown or
 * missing values fall back.
 */
export function parseViewParam<T extends string>(
  search: string,
  allowed: readonly T[],
  fallback: T,
): T {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("view");
  } catch {
    raw = null;
  }
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Return `search` with `view` set (or removed when it equals the default), so
 * the address bar always holds a shareable link to the current view.
 */
export function withViewParam(search: string, view: string, defaultView: string): string {
  const p = new URLSearchParams(search);
  if (view === defaultView) p.delete("view");
  else p.set("view", view);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Keys the menu hook handles, and where each moves focus. */
export type MenuKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * Next focused index in a vertical menu of `length` items. Arrow keys wrap;
 * Home/End jump. `current` of -1 (nothing focused yet) starts at the ends.
 */
export function nextMenuIndex(current: number, length: number, key: MenuKey): number {
  if (length <= 0) return -1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return length - 1;
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % length;
    case "ArrowUp":
      return current < 0 ? length - 1 : (current - 1 + length) % length;
  }
}

/** Selector for elements that can take keyboard focus inside a dialog. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable=true]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where Tab / Shift+Tab should wrap to inside a focus trap, or null to let the
 * browser move focus normally. `index` is the active element's position among
 * the trap's focusables (-1 when focus is on the container itself).
 */
export function trapTarget(index: number, length: number, shift: boolean): number | null {
  if (length === 0) return -1; // nothing focusable: keep focus on the container
  if (shift && index <= 0) return length - 1;
  if (!shift && (index === length - 1 || index === -1)) return 0;
  return null;
}
