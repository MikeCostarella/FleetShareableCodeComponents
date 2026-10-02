// Accessible names for Leaflet markers. Leaflet makes each marker icon a
// focusable role="button", but a divIcon has no text, so screen readers hear
// "button" 1,300 times (axe: aria-command-name). These put the name on the
// icon element. Duck-typed so this library needs no Leaflet import.

interface MarkerLike {
  getElement(): HTMLElement | undefined;
  on(type: "add", fn: () => void): unknown;
}

/** Set the name now (if the icon is on the map). For react-leaflet:
 *  eventHandlers={{ add: (e) => setMarkerLabel(e.target, r.name) }} */
export function setMarkerLabel(marker: { getElement(): HTMLElement | undefined }, label: string) {
  marker.getElement()?.setAttribute("aria-label", label);
}

/** Set the name whenever the icon is (re)added: clustering and filtering
 *  recreate icon elements. For plain L.marker(...) code. */
export function labelMarker(marker: MarkerLike, label: string) {
  marker.on("add", () => setMarkerLabel(marker, label));
  setMarkerLabel(marker, label);
}
