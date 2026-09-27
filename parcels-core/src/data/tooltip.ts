import type { Parcel } from "../types/point";
import { nameForType, colorForType } from "./../data/structTypes";

/** Escape user/data text before injecting into tooltip HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Tooltip HTML for a parcel: parcel number, owner / address, and a colored
 * class chip.
 */
export function tooltipHtml(p: Parcel): string {
  const title = `Parcel ${esc(p.parcelNumber)}`;
  const sub = p.owner ? `<br>${esc(p.owner)}` : "";
  const place = esc(p.address || "");
  const color = colorForType(p.type);
  return (
    `<b>${title}</b>${sub}` +
    (place ? `<br>${place}` : "") +
    `<br><span style="color:${color}">&#9679; ${esc(nameForType(p.type))}</span>`
  );
}
