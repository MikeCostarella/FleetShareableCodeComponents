import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * react-leaflet sometimes renders the map before its container has its final
 * size (especially inside a flex layout), leaving grey tiles until the first
 * user interaction. Calling invalidateSize() after mount forces a recalculation.
 */
export function useInvalidateSize(): null {
  const map = useMap();
  useEffect(() => {
    // A microtask-delayed invalidate covers the initial flex layout pass.
    const id = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(id);
  }, [map]);
  return null;
}

/** Renders nothing; just runs the resize fix inside a MapContainer. */
export function InvalidateSize() {
  return useInvalidateSize();
}
