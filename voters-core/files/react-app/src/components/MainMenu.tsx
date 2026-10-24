import { useEffect, useRef, useState } from "react";
import { BASE_MAP_IDS, BASE_MAP_LABELS } from "../vendor/basemaps/basemaps";
import type { BaseMapId } from "../vendor/basemaps/basemaps";

/** Canonical GitHub repository for this app. */
const GITHUB_REPO_URL =
  "https://github.com/MikeCostarella/{{REPO}}";

/** Mike Costarella's main website (hub linking to all the apps). */
const MY_WEBSITE_URL = "https://mikecostarella.github.io/MyWebSite/";

/** The OhioCounties hub: every Ohio county and the fleet apps for each. */
const OHIO_COUNTIES_URL = "https://mikecostarella.github.io/OhioCounties/";

/** Which view the app is showing. */
export type AppView = "map" | "list" | "reports";

interface MainMenuProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
  /** Base map choice and its setter (useBaseMap in App). */
  baseMap: BaseMapId;
  onSetBaseMap: (id: BaseMapId) => void;
  /** Exports the currently matching voters to a CSV download. */
  onExportCsv: () => void;
  /** True when there is nothing to export. */
  exportDisabled: boolean;
  /** Clears the search box and re-selects every party / city / precinct. */
  onReset: () => void;
  /** True when no search text and no filter is narrowing the list. */
  resetDisabled: boolean;
  /** Opens the Help & Guide dialog. */
  onOpenHelp: () => void;
}

/**
 * Hamburger menu in the header. Holds a "View" section (Map / Voter List /
 * Reports), a
 * "Tools" section (Export to CSV, Reset), and a "Links" section with Help,
 * MyWebSite, the Ohio Counties hub and the GitHub repository. Mirrors the menu in TrumbullCountyParcels so the
 * fleet apps behave the same way.
 *
 * Opens on click; closes on item select, a click outside, or Escape.
 */
export default function MainMenu({
  view,
  onViewChange,
  baseMap,
  onSetBaseMap,
  onExportCsv,
  exportDisabled,
  onReset,
  resetDisabled,
  onOpenHelp,
}: MainMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Run a menu action and close the dropdown. */
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const pick = (v: AppView) => {
    onViewChange(v);
    setOpen(false);
  };

  return (
    <div id="main-menu" ref={ref}>
      <button
        id="main-menu-btn"
        type="button"
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div id="main-menu-dropdown" role="menu">
          <div className="menu-section-label">View</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view === "map"}
            className={`menu-item${view === "map" ? " active" : ""}`}
            onClick={() => pick("map")}
          >
            Map
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view === "list"}
            className={`menu-item${view === "list" ? " active" : ""}`}
            onClick={() => pick("list")}
          >
            Voter List
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view === "reports"}
            className={`menu-item${view === "reports" ? " active" : ""}`}
            onClick={() => pick("reports")}
          >
            Reports
          </button>

          <div className="menu-section-label">Base map</div>
          {BASE_MAP_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={baseMap === id}
              className={`menu-item${baseMap === id ? " active" : ""}`}
              onClick={() => {
                onSetBaseMap(id);
                setOpen(false);
              }}
            >
              {BASE_MAP_LABELS[id]}
            </button>
          ))}

          <div className="menu-section-label">Tools</div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={exportDisabled}
            onClick={() => run(onExportCsv)}
          >
            Export to CSV
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={resetDisabled}
            onClick={() => run(onReset)}
          >
            Reset search &amp; filters
          </button>

          <div className="menu-section-label">Links</div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => run(onOpenHelp)}
          >
            Help &amp; Guide
          </button>
          <a
            role="menuitem"
            className="menu-item menu-link"
            href={MY_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            MyWebSite &#8599;
          </a>
          <a
            role="menuitem"
            className="menu-item menu-link"
            href={OHIO_COUNTIES_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            Ohio Counties &#8599;
          </a>
          <a
            role="menuitem"
            className="menu-item menu-link"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            GitHub Repository &#8599;
          </a>
          <a
            role="menuitem"
            className="menu-item menu-link"
            href={`${GITHUB_REPO_URL}/actions`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            GitHub Actions &#8599;
          </a>
        </div>
      )}
    </div>
  );
}
