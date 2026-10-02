import { version } from "react";

const REACT_19 = parseInt(version, 10) >= 19;

/**
 * Props that take a closed drawer (or the hidden map pane) out of the Tab
 * order and the accessibility tree together. aria-hidden alone hides it from
 * screen readers but leaves its buttons focusable, so keyboard users tab into
 * something invisible (axe: aria-hidden-focus). `inert` fixes both.
 *
 *   <aside className="filter-drawer" {...inertWhen(!open)}>
 *
 * React 18 passes `inert` through as a plain attribute (needs a string);
 * React 19 knows it as a boolean. This returns the right one for either.
 */
export function inertWhen(hidden: boolean): Record<string, unknown> {
  if (!hidden) return {};
  return { inert: REACT_19 ? true : "", "aria-hidden": true };
}

export default inertWhen;
