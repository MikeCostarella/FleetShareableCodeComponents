import L from "leaflet";

/**
 * Highlight marker for the point a user "Go To on Map"-ed from the list. A
 * pulsing amber ring (distinct from the cyan "You are here" marker and from the
 * structure-type dot colors) drawn as a CSS divIcon — no image asset. The ring
 * is hollow so the underlying canvas dot stays visible inside it. Animation and
 * colors are defined in global.css (.sel-hl-*).
 */
export const selectedHighlightIcon = L.divIcon({
  className: "sel-hl-icon",
  html: '<div class="sel-hl-pulse"></div><div class="sel-hl-ring"></div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});
