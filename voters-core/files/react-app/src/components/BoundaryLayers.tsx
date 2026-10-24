import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { BOUNDARY_LAYERS, fetchBoundary } from "../vendor/parcels-core/data/boundaries";

/** Which outlines are switched on. */
export interface BoundaryVisibility {
  municipalities: boolean;
  townships: boolean;
  precincts: boolean;
}

/** Colours match the fleet: orange municipalities, slate townships. */
const PRECINCT_COLOR = "#5bc4f5";

/**
 * Boundary outlines drawn in a pane *under* the voter dots, with pointer
 * events off so they never swallow a click.
 *
 * Municipalities and townships come live from Census TIGERweb through
 * parcels-core, which already knows how to scope them to the county (its
 * data/boundaries.ts carries the long history of getting that wrong).
 * Precincts are this app's own bundled GeoJSON, copied from
 * TrumbullCountyPrecincts - 68 KB, so there is no reason to fetch it.
 *
 * Each layer is built the first time it is switched on, then shown and hidden.
 */
export default function BoundaryLayers({ visible }: { visible: BoundaryVisibility }) {
  const map = useMap();
  const layersRef = useRef<Record<string, L.GeoJSON | null>>({});
  const fetchedRef = useRef<Record<string, boolean>>({});

  // Create the under-dots pane once.
  useEffect(() => {
    if (!map.getPane("boundaries")) {
      const pane = map.createPane("boundaries");
      pane.style.zIndex = "350"; // above tiles (200/400), below the canvas (450)
      pane.style.pointerEvents = "none";
    }
  }, [map]);

  // --- Municipalities + townships, from TIGERweb via parcels-core ---
  useEffect(() => {
    BOUNDARY_LAYERS.forEach((def) => {
      const on = visible[def.id as "municipalities" | "townships"];
      const existing = layersRef.current[def.id];

      if (on && !existing && !fetchedRef.current[def.id]) {
        fetchedRef.current[def.id] = true;
        fetchBoundary(def).then((geo: FeatureCollection | null) => {
          if (!geo) {
            fetchedRef.current[def.id] = false; // allow a retry on next toggle
            return;
          }
          const isMuni = def.id === "municipalities";
          const layer = L.geoJSON(geo, {
            pane: "boundaries",
            style: {
              color: def.color,
              weight: isMuni ? 3.5 : 2.5,
              opacity: isMuni ? 1 : 0.85,
              fill: false,
              dashArray: def.dashArray,
              lineJoin: "round",
            },
          });
          layersRef.current[def.id] = layer;
          // Only add if the toggle is still on now that the fetch has landed.
          if (visible[def.id as "municipalities" | "townships"]) layer.addTo(map);
        });
      } else if (on && existing) {
        existing.addTo(map);
      } else if (!on && existing) {
        existing.remove();
      }
    });
  }, [map, visible]);

  // --- Precincts, from the bundled GeoJSON ---
  useEffect(() => {
    const id = "precincts";
    const existing = layersRef.current[id];
    if (visible.precincts && !existing && !fetchedRef.current[id]) {
      fetchedRef.current[id] = true;
      fetch(`${import.meta.env.BASE_URL}data/precinct-boundaries.geojson`)
        .then((r) => (r.ok ? r.json() : null))
        .then((geo: FeatureCollection | null) => {
          if (!geo) {
            fetchedRef.current[id] = false;
            return;
          }
          const layer = L.geoJSON(geo, {
            pane: "boundaries",
            style: {
              color: PRECINCT_COLOR,
              weight: 2.5,
              opacity: 1,
              fill: false,
              dashArray: "4,5",
              lineJoin: "round",
            },
          });
          layersRef.current[id] = layer;
          if (visible.precincts) layer.addTo(map);
        })
        .catch(() => {
          fetchedRef.current[id] = false;
        });
    } else if (visible.precincts && existing) {
      existing.addTo(map);
    } else if (!visible.precincts && existing) {
      existing.remove();
    }
  }, [map, visible.precincts]);

  useEffect(() => {
    return () => {
      Object.values(layersRef.current).forEach((l) => l?.remove());
    };
  }, []);

  return null;
}
