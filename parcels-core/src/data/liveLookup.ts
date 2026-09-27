// The live-lookup seam.
//
// "Live lookup" means: given a parcel number, fetch what the county publishes
// about that parcel RIGHT NOW, as opposed to the snapshot in parcels.json.
// Where that comes from differs per county, and the difference is real:
//
//   - 54 counties query the one statewide ArcGIS layer  -> liveLookupStatewide
//   - 31 query their own auditor or GIS service          -> the county writes it
//   - 6 publish nothing usable                           -> liveLookupNone
//
// (Counted 6 August 2026; see Statehouse design/parcels-core-live-lookup-survey.md.)
//
// Each county's app picks one in its own `src/data/parcelLookup.ts`, which for
// most counties is a single re-export line. The library never picks.

/**
 * The minimum a live parcel record carries: the parcel it is about.
 *
 * DELIBERATELY ALMOST EMPTY, and the pilot is why. The first draft of this
 * interface had ten fields - owner, annual tax, delinquency, zoning, homestead,
 * deed date, taxpayer name - which looked universal because Franklin and
 * Trumbull both have them. Adams then turned out to publish fifteen fields
 * sharing only three with that list: class description, acreage, land and
 * improvement values, sale price, year built, bedrooms, baths, living area,
 * school district.
 *
 * There is no common set beyond the parcel number. A county declares its own
 * record extending this, and its own dialog reads it - the same shape as
 * `loadPoints`'s `extend` callback for `Parcel`. Anything else means 88
 * counties carrying columns three of them populate.
 */
export interface LiveParcelRecord {
  /** As the county prints it, not as the queried service stores it. */
  parcelNumber: string;
}

/**
 * What a county's `src/data/parcelLookup.ts` must export as
 * `fetchParcelByNumber`.
 *
 * Resolves to `null` when the service has no matching record - a normal
 * answer, not an error. THROWS on network or server failure, so the caller can
 * tell "this parcel has no live record" from "we could not ask". Conflating
 * those is how a county can look empty for months without anyone noticing.
 */
export type ParcelLookup<T extends LiveParcelRecord = LiveParcelRecord> = (
  parcelNumber: string,
  signal?: AbortSignal,
) => Promise<T | null>;
