/**
 * Base map catalogue for the fleet's Leaflet maps.
 *
 * Three choices, fleet-wide:
 *
 *   streets  CARTO Voyager (the fleet's basemap since 2024; API key added
 *            Aug 2026 when CARTO began requiring one).
 *   aerial   Ohio Statewide Imagery Program (OSIP) most-current orthoimagery,
 *            served as a Web Mercator tile cache by OGRIP (maps.ohio.gov).
 *            Public-domain state data, no key, no quota. Requested Sep 2026
 *            ("zoom in on the aerial") and chosen over Esri World Imagery
 *            because it is a level sharper (native tiles to zoom 20 in
 *            Trumbull County; Esri stops at 19) and it is the same imagery the
 *            county auditors use, so parcel lines sit on rooftops.
 *   hybrid   aerial + CARTO label tiles floating on top.
 *
 * Pure module: no React, no Leaflet, so it is unit-tested in plain Node.
 * The React pieces live next door in BaseMapLayers.tsx / BaseMapPicker.tsx /
 * useBaseMap.ts.
 */

export type BaseMapId = "streets" | "aerial" | "hybrid";

export const BASE_MAP_IDS: readonly BaseMapId[] = ["streets", "aerial", "hybrid"];

export const DEFAULT_BASE_MAP: BaseMapId = "streets";

/** localStorage key shared by every fleet app so the choice follows the user. */
export const BASE_MAP_STORAGE_KEY = "fleet-basemap";

/** What one Leaflet TileLayer needs. */
export interface TileSpec {
  url: string;
  attribution: string;
  /** Deepest zoom the server actually has tiles for; Leaflet upsamples past it. */
  maxNativeZoom: number;
  subdomains?: string;
}

/** Free CARTO key registered to Costarella Innovations (mikecostarella.github.io). */
export const CARTO_KEY = "cb1_2mty_1_1564a95dd2e80809e16b1914";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Voyager streets WITHOUT labels: drawn under the data so dots stay legible. */
export const CARTO_VOYAGER_NOLABELS: TileSpec = {
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  attribution: CARTO_ATTRIBUTION,
  subdomains: "abcd",
  maxNativeZoom: 19,
};

/** Voyager WITH labels: for apps that draw nothing dense enough to need the split. */
export const CARTO_VOYAGER: TileSpec = {
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  attribution: CARTO_ATTRIBUTION,
  subdomains: "abcd",
  maxNativeZoom: 19,
};

/** Voyager labels only (dark text, light halo) for use above the data on streets. */
export const CARTO_VOYAGER_LABELS: TileSpec = {
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  attribution: "",
  subdomains: "abcd",
  maxNativeZoom: 19,
};

/** Light text with a dark halo: what reads over aerial photography (hybrid). */
export const CARTO_DARK_LABELS: TileSpec = {
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  attribution: "",
  subdomains: "abcd",
  maxNativeZoom: 19,
};

/**
 * OSIP most-current statewide orthoimagery, cached in Web Mercator by OGRIP.
 * Service: https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer
 * The cache is defined to LOD 23 but tiles exist to level 20 (checked over
 * Girard, Sep 2026, via the service's /tilemap endpoint: level 20 present,
 * level 21 "Tiles not present"). Coverage is Ohio only.
 */
export const OSIP_AERIAL: TileSpec = {
  url: "https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer/tile/{z}/{y}/{x}",
  attribution:
    'Imagery &copy; <a href="https://das.ohio.gov/technology-and-strategy/ogrip/projects/osip">Ohio Statewide Imagery Program</a> (OGRIP)',
  maxNativeZoom: 20,
};

/**
 * How far the map may zoom on the aerial choices. One past the native tiles:
 * the 6-inch imagery still reads when doubled, and that extra level is the
 * whole point of the request.
 */
export const AERIAL_MAX_ZOOM = 21;

/** Menu text. "Aerial" not "Satellite": OSIP is flown, not orbital. */
export const BASE_MAP_LABELS: Record<BaseMapId, string> = {
  streets: "Streets",
  aerial: "Aerial",
  hybrid: "Aerial + labels",
};

export const BASE_MAP_HINTS: Record<BaseMapId, string> = {
  streets: "CARTO Voyager street map.",
  aerial: "Ohio Statewide Imagery Program orthophotos; zooms one level closer.",
  hybrid: "Aerial imagery with street and place names on top.",
};

export function isBaseMapId(v: unknown): v is BaseMapId {
  return typeof v === "string" && (BASE_MAP_IDS as readonly string[]).includes(v);
}

/** Map maxZoom for a choice; streets keeps whatever the app already allowed. */
export function maxZoomFor(id: BaseMapId, streetsMaxZoom = 19): number {
  return id === "streets" ? streetsMaxZoom : Math.max(streetsMaxZoom, AERIAL_MAX_ZOOM);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // some browsers throw on access when storage is blocked
  }
}

/** Stored choice, or the default when absent, invalid, or storage is unavailable. */
export function readStoredBaseMap(storage: StorageLike | null = defaultStorage()): BaseMapId {
  try {
    const v = storage?.getItem(BASE_MAP_STORAGE_KEY);
    return isBaseMapId(v) ? v : DEFAULT_BASE_MAP;
  } catch {
    return DEFAULT_BASE_MAP;
  }
}

/** Persist a choice; silently a no-op when storage is unavailable. */
export function writeStoredBaseMap(id: BaseMapId, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(BASE_MAP_STORAGE_KEY, id);
  } catch {
    /* private mode / quota: the choice just does not persist */
  }
}
