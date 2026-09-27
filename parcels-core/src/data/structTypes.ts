// Parcel "major class" catalog. Franklin County uses the Ohio DTE land-use
// code (a 3-digit number, e.g. 511). The first digit is the major class, which
// is what we color, cluster, filter, and key the legend on. The full code is
// retained on each parcel (Parcel.landUse) for display.
//
// NOTE: the exported names (StructType / STRUCT_TYPES / nameForType /
// colorForType / STRUCT_TYPE_LIST) are kept generic so the shared map/legend/
// filter components consume them unchanged; here a "type code" is the major
// parcel class (0-9).

export interface StructType {
  code: number;
  name: string;
  desc: string;
  color: string;
  letter: string;
}

export const STRUCT_TYPES: Record<number, StructType> = {
  1: { code: 1, name: "Agricultural", desc: "Farm / agricultural land (100-series)", color: "#5a8f3f", letter: "A" },
  2: { code: 2, name: "Mineral", desc: "Mineral rights / extraction (200-series)", color: "#8a6d3b", letter: "M" },
  3: { code: 3, name: "Industrial", desc: "Industrial property (300-series)", color: "#455a64", letter: "I" },
  4: { code: 4, name: "Commercial", desc: "Commercial / business (400-series)", color: "#1f6fb0", letter: "C" },
  5: { code: 5, name: "Residential", desc: "Residential property (500-series)", color: "#2e8b6f", letter: "R" },
  6: { code: 6, name: "Exempt", desc: "Tax-exempt: public / charitable (600-series)", color: "#7a4fa3", letter: "E" },
  7: { code: 7, name: "Exempt / Other", desc: "Other exempt classification (700-series)", color: "#b07d2b", letter: "X" },
  8: { code: 8, name: "Public Utility", desc: "Utility property (800-series)", color: "#5d6d7e", letter: "U" },
  9: { code: 9, name: "Other", desc: "Other / miscellaneous (900-series)", color: "#9a7a9a", letter: "O" },
  0: { code: 0, name: "Unclassified", desc: "Land-use class not recorded", color: "#9aa0a6", letter: "?" },
};

/** Catalog as an array in legend display order (1-9, then Unclassified last). */
export const STRUCT_TYPE_LIST: StructType[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 0,
].map((c) => STRUCT_TYPES[c]);

/** Major class code (0-9) from a raw Ohio land-use code like "511". */
export function majorClass(code: string | number | null | undefined): number {
  if (code === null || code === undefined) return 0;
  const m = String(code).match(/\d/);
  return m ? Number(m[0]) : 0;
}

/** Color for a major-class code, falling back to the Unclassified gray. */
export function colorForType(code: number): string {
  return (STRUCT_TYPES[code] ?? STRUCT_TYPES[0]).color;
}

/** Display name for a major-class code. */
export function nameForType(code: number): string {
  return (STRUCT_TYPES[code] ?? STRUCT_TYPES[0]).name;
}
