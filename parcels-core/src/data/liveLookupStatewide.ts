// Live lookup against the Ohio Statewide Parcels layer - the implementation
// 54 of the 88 county apps use.
//
// Nothing in here is county-specific except two values read from
// config/county.ts: COUNTY_NAME (via COUNTY_WHERE) scopes the query, and
// STATE_PARCEL_KEY decides how this county's parcel number must be written in
// the WHERE clause. The layer holds each county's LocalParcelID in that
// county's OWN format - Franklin's carry punctuation, Logan's do not - so
// there is no fleet-wide rule and a wrong value returns zero features rather
// than an error. Four counties shipped a silently dead lookup that way.
//
// The service is thin: of the ten fields LiveParcelRecord carries it populates
// about three. The rest are null here and populated by counties that query
// their own auditor instead. That is a property of the source, not a bug.
//
// A county selects this by re-exporting it from src/data/parcelLookup.ts.

import type { LiveParcelRecord, ParcelLookup } from "./liveLookup";
import { stateQueryKey, COUNTY_WHERE, QUERY_BASE } from "./statewideLayer";

/**
 * What the statewide layer can tell you about a parcel.
 *
 * Eight of these are always null - the service does not expose them. They are
 * declared anyway because the detail dialog renders whatever is present, and a
 * county moving from this implementation to its own auditor service tends to
 * gain exactly these.
 */
export interface StatewideParcelRecord extends LiveParcelRecord {
  owner: string | null;
  locationAddress: string | null;
  annualTax: number | null;
  delinquent: number | null;
  zoning: string | null;
  homestead: boolean | null;
  deedRecorded: string | null;
  taxpayerName: string | null;
  taxpayerMailing: string | null;
}


/** Raw attribute shape we read from the statewide Parcels layer. */
interface RawAttrs {
  LocalParcelID?: string | null;
  StateParcelID?: string | null;
  County?: string | null;
  StateLUC?: string | null;
  // Situs (property location) address, pre-assembled by the service.
  SitusAddressAll?: string | null;
  // Owner / taxpayer mailing address (pre-assembled + parts).
  MailAddressAll?: string | null;
  MailNumber?: string | null;
  MailStreetPrefix?: string | null;
  MailStreetName?: string | null;
  MailStreetSuffix?: string | null;
  MailUnitNumber?: string | null;
  MailCity?: string | null;
  MailZip?: string | null;
  MailState?: string | null;
}

const OUT_FIELDS = [
  "LocalParcelID",
  "StateParcelID",
  "County",
  "StateLUC",
  "SitusAddressAll",
  "MailAddressAll",
  "MailNumber",
  "MailStreetPrefix",
  "MailStreetName",
  "MailStreetSuffix",
  "MailUnitNumber",
  "MailCity",
  "MailZip",
  "MailState",
].join(",");

/** Trim a field: collapse whitespace, treat blanks as null. */
function clean(s: string | null | undefined): string | null {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v ? v : null;
}

/** Join address parts into one space-separated line (skipping blanks). */
function joinParts(parts: (string | null | undefined)[]): string | null {
  const line = parts
    .map((p) => clean(p))
    .filter(Boolean)
    .join(" ");
  return line ? line : null;
}

/** Prefer the service's pre-assembled MailAddressAll; else build from parts. */
function buildMailing(a: RawAttrs): string | null {
  const pre = clean(a.MailAddressAll);
  if (pre) return pre;
  const line1 = joinParts([
    a.MailNumber,
    a.MailStreetPrefix,
    a.MailStreetName,
    a.MailStreetSuffix,
    a.MailUnitNumber,
  ]);
  const city = clean(a.MailCity);
  const state = clean(a.MailState);
  const zip = clean(a.MailZip);
  const cityState = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [line1, cityState].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function normalize(a: RawAttrs, displayNumber: string): StatewideParcelRecord {
  return {
    // Report the county's punctuated parcel number back, not the statewide
    // service's stripped LocalParcelID, so the dialog stays consistent.
    parcelNumber: displayNumber || (clean(a.LocalParcelID) ?? ""),
    // The statewide service does not carry owner/tax/zoning/etc.
    owner: null,
    locationAddress: clean(a.SitusAddressAll),
    annualTax: null,
    delinquent: null,
    zoning: null,
    homestead: null,
    deedRecorded: null,
    taxpayerName: null,
    taxpayerMailing: buildMailing(a),
  };
}

/**
 * Look up one parcel's live record by parcel number (LocalParcelID) within
 * Franklin County. Returns null when the service has no matching record. Throws
 * on network / server errors so the caller can show a retry/error state.
 */
export const fetchParcelByNumber: ParcelLookup<StatewideParcelRecord> = async (parcelNumber, signal) => {
  // How the number must be written is per-county — see STATE_PARCEL_KEY in
  // config/county.ts. Franklin is "as-stored"; querying the stripped form
  // returned zero features and the dialog reported no live record.
  const safe = stateQueryKey(parcelNumber).replace(/'/g, "''"); // escape for the SQL where
  if (!safe) return null;
  const params = new URLSearchParams({
    where: `${COUNTY_WHERE} AND LocalParcelID='${safe}'`,
    outFields: OUT_FIELDS,
    returnGeometry: "false",
    f: "json",
  });

  const res = await fetch(`${QUERY_BASE}/query?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Parcel lookup failed (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as {
    error?: { message?: string };
    features?: { attributes: RawAttrs }[];
  };
  if (data.error) {
    throw new Error(data.error.message || "Parcel lookup error");
  }
  const attrs = data.features?.[0]?.attributes;
  return attrs ? normalize(attrs, parcelNumber) : null;
};
