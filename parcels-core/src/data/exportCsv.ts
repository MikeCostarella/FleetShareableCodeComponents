import type { Parcel } from "../types/point";
import { nameForType } from "./structTypes";
import { HAS_VALUATION } from "../../../config/county";

/** Wrap a value for CSV: stringify, double embedded quotes, and quote always. */
function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

/** Every parcel is in this county — see config/county.ts. */
const STATE_VALUE = "OH";

/** Column headers, in output order. Owner is included only when showOwner, and
 *  the four value columns only when the county publishes valuation. */
function headers(showOwner: boolean): string[] {
  return [
    "ParcelNumber",
    ...(showOwner ? ["Owner"] : []),
    "Address",
    "Jurisdiction",
    "State",
    "Zip",
    "Class",
    "LandUseCode",
    "Acres",
    ...(HAS_VALUATION
      ? ["LandMarket", "BuildingMarket", "TotalMarket", "TotalAssessed"]
      : []),
    "SaleDate",
    "Description",
    "Latitude",
    "Longitude",
  ];
}

/** Build CSV text (with header row) for the given parcels. */
export function pointsToCsv(points: Parcel[], showOwner = false): string {
  const rows = [headers(showOwner).map(csvCell).join(",")];
  for (const p of points) {
    rows.push(
      [
        csvCell(p.parcelNumber ?? ""),
        ...(showOwner ? [csvCell(p.owner ?? "")] : []),
        csvCell(p.address ?? ""),
        csvCell(p.jurisdiction ?? ""),
        csvCell(STATE_VALUE),
        csvCell(p.zip ?? ""),
        csvCell(nameForType(p.type)),
        csvCell(p.landUse ?? ""),
        csvCell(p.acres),
        ...(HAS_VALUATION
          ? [
              csvCell(p.landMarket),
              csvCell(p.buildingMarket),
              csvCell(p.totalMarket),
              csvCell(p.totalAssessed),
            ]
          : []),
        csvCell(p.saleDate ?? ""),
        csvCell(p.description ?? ""),
        csvCell(p.hasCoord ? p.lat : ""),
        csvCell(p.hasCoord ? p.lon : ""),
      ].join(","),
    );
  }
  return rows.join("\r\n");
}

/**
 * Trigger a browser download of the given parcels as a CSV file. Prepends a
 * UTF-8 BOM so Excel opens it with correct encoding, and timestamps the
 * filename. Owner is included only when `showOwner`. No-ops on an empty set.
 */
export function downloadPointsCsv(
  points: Parcel[],
  showOwner = false,
  filenameBase = "franklin-county-parcels",
): void {
  if (!points.length) return;
  const bom = "﻿";
  const blob = new Blob([bom + pointsToCsv(points, showOwner)], {
    type: "text/csv;charset=utf-8;",
  });
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
