import L from "leaflet";

/**
 * "You are here" marker: a pulsing cyan dot built as a CSS divIcon (no image
 * asset needed). The pulse animation is defined in global.css (.user-loc-*).
 */
export const userLocationIcon = L.divIcon({
  className: "user-loc-icon",
  html: '<div class="user-loc-pulse"></div><div class="user-loc-dot"></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});
