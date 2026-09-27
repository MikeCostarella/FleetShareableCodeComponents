import { useEffect, useState } from "react";

/**
 * Tracks which layout mode we're in based on a width breakpoint, returning a
 * stable string ("mobile" | "desktop") that only changes when the breakpoint is
 * crossed.
 *
 * This exists so the map can be given a React `key` that flips on a
 * desktop<->mobile transition, forcing a clean unmount/remount. The canvas
 * point layer's position, viewport-culling bounds, and devicePixelRatio all
 * depend on the map's size being correct; reconciling those across a viewport
 * switch proved fragile, so remounting from scratch is the robust answer.
 *
 * The 640px threshold matches the mobile breakpoint used in the stylesheet.
 */
export function useLayoutBreakpoint(): "mobile" | "desktop" {
  const query = "(max-width: 640px)";
  const [mode, setMode] = useState<"mobile" | "desktop">(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches
      ? "mobile"
      : "desktop",
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMode(mql.matches ? "mobile" : "desktop");
    onChange();
    // addEventListener('change') is the modern API; fall back for older Safari.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return mode;
}
