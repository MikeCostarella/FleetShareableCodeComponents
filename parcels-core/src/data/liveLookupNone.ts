// Live lookup for counties that publish nothing usable.
//
// Six counties as of 6 August 2026: Ashland, Erie, Huron, Tuscarawas, Vinton,
// Wood. Ashland is the documented case - the county's hosted parcel layer is a
// survey fabric with no owner or valuation data, and the auditor's ISSG system
// has no JSON API. There is nothing to fetch.
//
// This is a Null Object, not a stub: it satisfies the interface so the detail
// dialog needs no special case, and it resolves to `null`, which the dialog
// already renders as "no additional live record". The county's Auditor button
// carries the user to the authoritative record instead.
//
// Deliberately NOT an error. A county with no service is a fact about that
// county, not a failure of this app.

import type { ParcelLookup } from "./liveLookup";

export type { LiveParcelRecord } from "./liveLookup";

export const fetchParcelByNumber: ParcelLookup = async () => null;
