import { useEffect } from "react";
import { Pane, TileLayer, useMap } from "react-leaflet";
import {
  CARTO_DARK_LABELS,
  CARTO_VOYAGER_LABELS,
  CARTO_VOYAGER_NOLABELS,
  OSIP_AERIAL,
  maxZoomFor,
} from "./basemaps";
import type { BaseMapId, TileSpec } from "./basemaps";

export interface BaseMapLayersProps {
  /** Which base map to draw; from useBaseMap(). */
  baseMap: BaseMapId;
  /**
   * Ground tiles for "streets". Default: CARTO Voyager without labels, which
   * is what the parcels apps draw under their dots. An app that keeps plain
   * OpenStreetMap passes its own spec here and `streetsLabels={null}`.
   */
  streets?: TileSpec;
  /**
   * Label tiles drawn over the data on "streets". Default: Voyager labels.
   * Pass null when the streets tiles already carry their own labels (OSM).
   */
  streetsLabels?: TileSpec | null;
  /** Label tiles for "hybrid". Default: CARTO dark labels (light text over photo). */
  hybridLabels?: TileSpec;
  /**
   * Leaflet pane the label tiles render in. Default z 460: above the overlay
   * pane (400, where canvas dots and polygons draw) and below markers (600),
   * so names stay readable over data without covering pins. Pass false to
   * render labels as an ordinary tile layer.
   */
  labelsPane?: { name?: string; zIndex?: number } | false;
  /** The map's own maxZoom for streets (its MapContainer value). Default 19. */
  streetsMaxZoom?: number;
}

/**
 * The fleet's base map: one ground tile layer plus, when the choice calls for
 * it, a click-through labels layer above the data. Also moves the map's
 * maxZoom with the choice, since react-leaflet's MapContainer only reads its
 * maxZoom prop once: aerial and hybrid go to AERIAL_MAX_ZOOM (21), streets
 * back to the app's ceiling (Leaflet zooms out if the map is past it).
 *
 * Tile layers are keyed by choice so a switch remounts them; react-leaflet
 * does not re-read maxNativeZoom on an existing layer.
 */
export default function BaseMapLayers({
  baseMap,
  streets = CARTO_VOYAGER_NOLABELS,
  streetsLabels = CARTO_VOYAGER_LABELS,
  hybridLabels = CARTO_DARK_LABELS,
  labelsPane = {},
  streetsMaxZoom = 19,
}: BaseMapLayersProps) {
  const maxZoom = maxZoomFor(baseMap, streetsMaxZoom);
  const ground: TileSpec = baseMap === "streets" ? streets : OSIP_AERIAL;
  const labels: TileSpec | null =
    baseMap === "hybrid" ? hybridLabels : baseMap === "streets" ? streetsLabels : null;

  const labelLayer = labels ? (
    <TileLayer
      key={`labels-${baseMap}`}
      url={labels.url}
      attribution={labels.attribution}
      subdomains={labels.subdomains ?? "abc"}
      maxZoom={maxZoom}
      maxNativeZoom={labels.maxNativeZoom}
    />
  ) : null;

  return (
    <>
      <SyncMaxZoom maxZoom={maxZoom} />
      <TileLayer
        key={`ground-${baseMap}`}
        url={ground.url}
        attribution={ground.attribution}
        subdomains={ground.subdomains ?? "abc"}
        maxZoom={maxZoom}
        maxNativeZoom={ground.maxNativeZoom}
      />
      {labelsPane === false ? (
        labelLayer
      ) : (
        <Pane
          name={labelsPane.name ?? "basemap-labels"}
          style={{ zIndex: labelsPane.zIndex ?? 460, pointerEvents: "none" }}
        >
          {labelLayer}
        </Pane>
      )}
    </>
  );
}

function SyncMaxZoom({ maxZoom }: { maxZoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setMaxZoom(maxZoom);
  }, [map, maxZoom]);
  return null;
}
