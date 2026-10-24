import { useState } from "react";
import { MapContainer } from "react-leaflet";
import BaseMapLayers from "../vendor/basemaps/BaseMapLayers";
import type { BaseMapId } from "../vendor/basemaps/basemaps";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_CENTER, MAP_ZOOM } from "../config/county";
import { InvalidateSize } from "../vendor/parcels-core/hooks/useInvalidateSize";
import { MapController } from "../vendor/parcels-core/hooks/useMapController";
import type { Voter } from "../types/voter";
import BoundaryLayers, { type BoundaryVisibility } from "./BoundaryLayers";
import MapLegend, { type LegendRow } from "./MapLegend";
import VoterCanvasLayer, { type HoverInfo, type MappedVoter } from "./VoterCanvasLayer";
import VoterHoverCard from "./VoterHoverCard";

/** What the dots are coloured by. "ballot" exists only during early voting. */
export type MapColorBy = "party" | "ballot";

interface VoterMapProps {
  /** Base map choice (streets / aerial / hybrid) from useBaseMap(). */
  baseMap?: BaseMapId;
  /** Every voter that has coordinates. Filtering happens in the draw loop. */
  points: MappedVoter[];
  /** Colour per `type` index in `points`. */
  colors: string[];
  /** 1 = show, 0 = hide, aligned to `points`; null when nothing is filtered. */
  mask: Uint8Array | null;
  /** Legend rows for the current colouring, over the current result set. */
  legend: LegendRow[];
  colorBy: MapColorBy;
  /** Present only while an early-voting colouring is available. */
  onColorBy?: (next: MapColorBy) => void;
  /** A legend count was clicked: narrow to that party or ballot status. */
  onPickLegend?: (code: string) => void;
  onSelect: (v: Voter) => void;
  /** Hands the Leaflet instance up so "Show on map" can fly to a voter. */
  onMapReady?: (map: LeafletMap) => void;
}

/**
 * The map view: unlabelled base tiles, boundary outlines, the voter canvas,
 * then labels-only tiles above the dots so street names stay readable.
 */
export default function VoterMap({
  baseMap = "streets",
  points,
  colors,
  mask,
  legend,
  colorBy,
  onColorBy,
  onPickLegend,
  onSelect,
  onMapReady,
}: VoterMapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [boundaries, setBoundaries] = useState<BoundaryVisibility>({
    municipalities: true,
    townships: true,
    precincts: true,
  });

  return (
    <div id="map-wrap">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        minZoom={9}
        maxZoom={19}
        zoomControl={true}
        preferCanvas={true}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Streets (CARTO, no labels) or OSIP aerial, plus the labels pane above
            the data (z 460); see vendor/basemaps. Moves maxZoom with the choice. */}
        <BaseMapLayers baseMap={baseMap} />
        <BoundaryLayers visible={boundaries} />
        <VoterCanvasLayer
          points={points}
          colors={colors}
          mask={mask}
          onSelect={onSelect}
          onHover={setHover}
        />
        <InvalidateSize />
        {onMapReady && <MapController onReady={onMapReady} />}
      </MapContainer>
      <MapLegend
        rows={legend}
        onPick={onPickLegend}
        colorBy={colorBy}
        onColorBy={onColorBy}
        visible={boundaries}
        onToggle={setBoundaries}
      />
      <VoterHoverCard hover={hover} />
    </div>
  );
}
