import { useEffect, useRef } from "react";
import { readDeepLink, type DeepLink } from "../data/deepLink";

/**
 * Run a deep-link search (`?q=...&lat=...&lon=...`, see data/deepLink.ts) once,
 * as soon as the app is ready to search, meaning its parcels have loaded.
 *
 * - `ready`: true once a search can run (the app passes `points !== null`).
 * - `search(q)`: the app's own search, run with an explicit query. It returns
 *   how many parcels it found, so the hook knows whether to fall back.
 * - `show(q)`: put the query in the search box and open the Search panel, so
 *   the visitor sees what was searched and can edit it.
 * - `flyTo(lat, lon)`: the fallback when the text search finds nothing.
 *
 * The URL is read on the first ready render and never again, so later
 * searches, edits and re-renders are the visitor's. The link stays in the
 * address bar: it is shareable, and a reload repeats it.
 */
export function useDeepLinkSearch(
  ready: boolean,
  search: (q: string) => number,
  show: (q: string) => void,
  flyTo: (lat: number, lon: number) => void,
): void {
  // undefined = URL not read yet; null = nothing (left) to do.
  const pending = useRef<DeepLink | null | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    if (pending.current === undefined) {
      pending.current = typeof window === "undefined" ? null : readDeepLink(window.location.search);
    }
    const link = pending.current;
    if (!link) return;
    pending.current = null;

    if (link.q) show(link.q);
    const found = link.q ? search(link.q) : 0;
    if (found === 0 && link.lat !== undefined && link.lon !== undefined) {
      flyTo(link.lat, link.lon);
    }
  }, [ready, search, show, flyTo]);
}
