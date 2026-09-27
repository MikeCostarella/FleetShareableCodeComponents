# address-lookup: vendored library

**Do not edit anything in this directory.** It is a copy of
`FleetShareableCodeComponents/address-lookup/src`, placed here by Statehouse's
`sync-shared-code.py --lib address-lookup`. Fix it there, bump `VERSION`, and sync.

It turns an Ohio street address into links to the right county's parcels app:

```js
import { lookupWithJsonp, lookupWithFetch } from "./addressLookup.js";

const r = await lookupWithJsonp("4761 Waterloo Rd, Atwater, OH 44201"); // web pages
// const r = await lookupWithFetch(address);  // extensions (host permission)
// r.status: "found" | "none" | "not-ohio" | "no-app" | "error"
// r.links:  [{ county: "Portage", url: ".../PortageCountyParcels/?q=4761+WATERLOO+RD%2C+44201&lat=..&lon=..", match }]
```

- `addressLookup.js`: the Census geocoder call and the result handling. Plain JS,
  typed by `addressLookup.d.ts`.
- `parcelsApps.js`: county FIPS → parcels app URL. It is **generated** from the
  Statehouse manifest (`npm run build:parcels-apps` in FleetShareableCodeComponents).

The `url` is a parcels-core 1.11.0 deep link; the app runs the search on load.

Used by: OhioCounties (hub "Find a parcel by address"),
OhioFleetAddressParcelSearchBrowserExtension (Ohio Parcel Finder).
