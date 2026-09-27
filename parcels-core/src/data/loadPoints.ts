import type { Parcel, RawParcel } from "../types/point";
import { majorClass } from "./structTypes";

/**
 * The single data seam for the app. Everything consumes Parcel[] from here;
 * this is the only place that knows the data is a static JSON file.
 *
 * The JSON ships in public/data and is fetched at runtime. It is deliberately
 * kept out of the JS bundle and out of the PWA precache; the service worker
 * caches it at runtime instead (see vite.config.ts).
 *
 * WHY THIS UNDERSTANDS TWO SHAPES
 *
 * GITHUB REFUSES ANY FILE OVER 100 MB. Not a warning — the push is rejected,
 * and the file has to come out of history before the repository can be
 * published at all. Franklin's 493,437 parcels come to 112 MB in one array, so
 * for this county parcels.json is not the data: it is a MANIFEST naming the
 * files that are.
 *
 *   { "chunks": ["parcels-1.json", "parcels-2.json", "parcels-3.json"],
 *     "count": 493437 }
 *
 * Smaller counties still ship a plain array, and both shapes are handled here
 * so the other eighty-odd apps need no change. A manifest is detected by being
 * an object with a `chunks` array rather than by county or by size.
 *
 * The chunks are fetched in parallel and concatenated. That is not a streaming
 * loader — peak memory is still the whole county — but it is what gets the data
 * past GitHub's limit, and it is the seam a real progressive loader would be
 * built on later.
 */
interface ChunkManifest {
  chunks: string[];
  count?: number;
}

function isManifest(v: unknown): v is ChunkManifest {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as ChunkManifest).chunks) &&
    (v as ChunkManifest).chunks.every((c) => typeof c === "string")
  );
}

/**
 * Fetch one JSON file and fail with a message that says what is wrong.
 *
 * A dev server answers a missing file by serving index.html rather than a 404,
 * and a misconfigured host can return an error page with a 200. Parsing that as
 * JSON produces `Unexpected token '<'`, which tells whoever sees it nothing
 * about what is actually wrong.
 */
async function fetchJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Parcel data is missing (${label}). Run the build script.`
        : `Failed to load parcels (${res.status} ${res.statusText}) from ${label}`,
    );
  }
  const body = await res.text();
  if (/^\s*</.test(body)) {
    throw new Error(
      `Parcel data is missing — the server returned a web page instead of ` +
        `${label}. Run the build script that generates it.`,
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Parcel data is not valid JSON (${label} is corrupt).`);
  }
}

/**
 * Load this county's parcels.
 *
 * COUNTIES CARRY DIFFERENT DATA, AND THE SHARED TYPE MUST NOT ACCRETE IT ALL.
 *
 * Some counties publish fields others do not — Adams denormalizes a census
 * tract GEOID and a USDA food-desert flag onto every parcel because it ships
 * demographic overlays; its Auditor deep-link is keyed by a PIN rather than an
 * internal id. Folding all of that into `Parcel` would mean the shared type
 * grows a field every time one county publishes something new.
 *
 * So the base record is the common core, and a county that carries more passes
 * an `extend` callback that receives the raw record and the base parcel and
 * returns its own wider type. Counties with nothing extra call `loadPoints()`
 * and get `Parcel[]`, unchanged.
 */
export async function loadPoints<T extends Parcel = Parcel>(
  extend?: (raw: RawParcel, base: Parcel) => T,
): Promise<T[]> {
  // import.meta.env.BASE_URL resolves to the Vite `base`
  // ("/<County>CountyParcels/"), so the fetch path is correct on GitHub Pages
  // and in local dev alike.
  const base = `${import.meta.env.BASE_URL}data/`;
  const first = await fetchJson(`${base}parcels.json`, "public/data/parcels.json");

  let raw: unknown[];
  if (Array.isArray(first)) {
    raw = first;
  } else if (isManifest(first)) {
    const parts = await Promise.all(
      first.chunks.map((name) => fetchJson(`${base}${name}`, `public/data/${name}`)),
    );
    parts.forEach((part, i) => {
      if (!Array.isArray(part)) {
        throw new Error(`Parcel chunk ${first.chunks[i]} did not contain an array.`);
      }
    });
    raw = (parts as unknown[][]).flat();
    if (typeof first.count === "number" && raw.length !== first.count) {
      throw new Error(
        `Parcel data is incomplete: the manifest promises ${first.count.toLocaleString()} ` +
          `parcels but the chunks hold ${raw.length.toLocaleString()}. Re-run the build.`,
      );
    }
  } else {
    throw new Error("parcels.json is neither an array nor a chunk manifest.");
  }

  return (raw as RawParcel[]).map((r) => {
    const hasCoord = typeof r.y === "number" && typeof r.x === "number";
    const base: Parcel = {
      parcelNumber: r.n,
      owner: r.o,
      description: r.d,
      landUse: r.u,
      type: majorClass(r.u),
      jurisdiction: r.j,
      taxingDistrict: r.td ?? "",
      township: r.tw ?? "",
      acres: r.a,
      landMarket: r.lm,
      buildingMarket: r.bm,
      totalMarket: r.tm,
      totalAssessed: r.ta,
      saleDate: r.s,
      address: r.f,
      zip: r.z,
      lat: hasCoord ? (r.y as number) : 0,
      lon: hasCoord ? (r.x as number) : 0,
      hasCoord,
      approxCoord: hasCoord && r.c === 1,
      // Undefined rather than 0 or "": absent is not the same as zero, and a
      // falsy sentinel is what let a URL hide in this field for twelve counties.
      auditorId:
        r.p === undefined || r.p === null || r.p === 0 || r.p === ""
          ? undefined
          : String(r.p),
    };
    return (extend ? extend(r, base) : (base as T));
  });
}

export interface NamedCount {
  name: string;
  count: number;
}

/** Distinct jurisdictions with parcel counts, sorted by count descending. */
export function jurisdictionCounts(points: Parcel[]): NamedCount[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(p.jurisdiction, (m.get(p.jurisdiction) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/** Per-major-class parcel counts keyed by class code. */
export function typeCounts(points: Parcel[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of points) m.set(p.type, (m.get(p.type) ?? 0) + 1);
  return m;
}

/**
 * Distinct taxing districts with parcel counts, "Unassigned" last. Counties
 * that do not publish a taxing district get a single empty-name bucket, and
 * their app simply does not offer the filter.
 */
export function taxingDistrictCounts(points: Parcel[]): NamedCount[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(p.taxingDistrict || "Unassigned", (m.get(p.taxingDistrict || "Unassigned") ?? 0) + 1);
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.name === "Unassigned") return 1;
      if (b.name === "Unassigned") return -1;
      return a.name.localeCompare(b.name);
    });
}
