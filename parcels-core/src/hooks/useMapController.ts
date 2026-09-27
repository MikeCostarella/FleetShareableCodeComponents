import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";

/**
 * Imperative escape hatch: hands the Leaflet map instance up to the parent so
 * non-declarative actions (flyTo on search) can be triggered from outside the
 * MapContainer. Renders nothing.
 */
export function MapController({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}
