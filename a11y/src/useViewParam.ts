import { useEffect, useState } from "react";
import { parseViewParam, withViewParam } from "./a11y";

/**
 * View state seeded from ?view= and mirrored back into the address bar, so
 * "?view=list" is a link you can hand anyone who asks for the accessible
 * version. Drop-in for useState<View>("map").
 */
export function useViewParam<T extends string>(allowed: readonly T[], defaultView: T) {
  const [view, setView] = useState<T>(() =>
    typeof window === "undefined"
      ? defaultView
      : parseViewParam(window.location.search, allowed, defaultView),
  );
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const next = withViewParam(search, view, defaultView);
    if (next !== search) {
      window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
    }
  }, [view, defaultView]);
  return [view, setView] as const;
}

export default useViewParam;
