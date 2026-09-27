// Domain types for the Franklin County Parcels map.
//
// The runtime JSON (public/data/parcels.json) uses short keys to keep the
// ~27k-row payload small. We expand them into a readable shape on load.

/** Raw record as stored in parcels.json (short keys, see scripts/build-parcels.mjs). */
export interface RawParcel {
  n: string; // parcel number (Parcel_Number)
  o: string; // owner name
  d: string; // legal/property description
  u: string; // Ohio land-use code (e.g. "511")
  j: string; // jurisdiction (municipality/township, or "Unassigned")
  td?: string; // taxing district, where the county publishes one
  tw?: string; // containing civil township (only when j is a city/village in one)
  a: number; // acres
  lm: number; // land market value
  bm: number; // building market value
  tm: number; // total market value
  ta: number; // total assessed value
  s: string; // sale date (YYYY-MM-DD or "")
  f: string; // full parcel address
  z: string; // zip
  y?: number; // latitude (omitted when the parcel has no matched coordinate)
  x?: number; // longitude
  c?: number; // 1 when y/x is an approximate polygon-centroid (not address-matched)
  p?: number | string; // Auditor's internal property id; string in some counties
}

/** An expanded parcel record used throughout the app. */
export interface Parcel {
  /** Parcel number as the Auditor prints it. The county's format may not have been read
   *  yet; see data/parcelGeometry.ts for the normalization used when joining to
   *  the statewide service, which is also unverified for this county. */
  parcelNumber: string;
  owner: string;
  description: string;
  /** Raw Ohio land-use code, e.g. "511". Shown in detail/list. */
  landUse: string;
  /** Major class code (first digit of the land-use code, 0-9); see parcelClasses. */
  type: number;
  jurisdiction: string;
  /** Auditor taxing-district name. "" for counties that do not publish one. */
  taxingDistrict: string;
  /** Civil township containing the parcel, when its jurisdiction is a city/village
   *  that sits inside a township. "" for rural parcels (township is the
   *  jurisdiction itself) or independent cities. */
  township: string;
  acres: number;
  landMarket: number;
  buildingMarket: number;
  totalMarket: number;
  totalAssessed: number;
  saleDate: string;
  /** Full street address ("" for vacant land with no address). */
  address: string;
  zip: string;
  /** Latitude/longitude (0 when the parcel was not address-matched). */
  lat: number;
  lon: number;
  /** True when the parcel has a coordinate and can be drawn on the map. */
  hasCoord: boolean;
  /** True when the coordinate is an approximate polygon centroid (lot center)
   *  rather than an address-matched point. */
  approxCoord: boolean;
  /** The County Auditor's internal property id, when the county's deep-link is
   *  keyed by one rather than by the printed parcel number. Undefined when the
   *  county publishes none, in which case the app links the Auditor's search
   *  page instead.
   *
   *  STRING, NOT NUMBER, and that is deliberate. Counted 7 August 2026 across
   *  the 88 Parcels repos: 9 declared it `number` (Franklin's `610207489`), 2
   *  declared it `string` holding the identical kind of value (`"16836"`). One
   *  concept, two types, for no reason anyone recorded. Every consumer
   *  interpolates it into a URL, so string is the honest type and the numeric
   *  counties lose nothing. */
  auditorId?: string;

  /** A ready-made Auditor deep link, for counties that publish the whole URL
   *  rather than a key to build one from.
   *
   *  This exists because twelve counties were storing exactly that IN
   *  `auditorId` - a full `https://beacon.schneidercorp.com/Application.aspx?...`
   *  under a field named for an id, with a doc comment calling it "the
   *  auditor's internal Property ID". Three different meanings had accumulated
   *  under one name; a shared `Parcel` cannot carry that. Populate one or the
   *  other, never both, and let the county's `data/mapsLink.ts` prefer whichever
   *  it has.
   *
   *  The library's loader does not set this: the raw key differs per county
   *  (Vinton's is `pid`, and Adams uses `pid` for something else entirely).
   *  Counties map it through the loader's `extend` callback. */
  auditorUrl?: string;
}
