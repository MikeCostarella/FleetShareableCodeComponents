# address-match

Fleet address matcher: places a street address from an outside file (a voter
roll, a DOLC liquor permit, a business list) using the datasets the fleet
already has for a county — `*CountyAddressPoints`, `*CountyParcels` (chunk
index honoured), `*CountyVoters` (geocoded addresses with precinct) — and
locates the point inside jurisdiction / precinct polygons.

The normalisation is the one that took the Voters fleet from 54% to ~90%
placed (trailing quadrants, two-letter auditor street types, state/county/
township route spellings, places and ZIPs written into the situs address,
doubles with number ranges), lifted out of `voters-core/geocode-voters.mjs`
so every consumer matches the same way. Plain ESM, no dependencies.

```js
import { buildIndex, matchAddress, buildPolygonIndex, splitCompound, TIER } from "./addressMatch.mjs";
const ix = buildIndex({ addressPoints, parcels, voters, cities });
const m = matchAddress(ix, { street: "1810-12 N 4TH ST", city: "COLUMBUS", zip: "43201" });
// { tier, lat, lon, parcelId, jurisdiction, precinct, candidates }
```

1.1.0 (10 Nov 2026) adds the spellings the DOLC permit file brought out:
routes written solid ("SR598", "US22", "OH-14", "CR16"), numbered streets
("W 117TH" = "W 117" = "FOURTH"), CTR/CENTER, PLZ/PLAZA, a trailing PK as
PIKE, "NO"/"SO" directionals, half addresses and unit letters after the house
number, UNITS / SUITES / "1ST FL" / REAR, second lines and "AKA" addresses,
runs of numbers ("5676-78-80"), a missing directional when only one of
N/S/E/W has the number, and the parcel's own jurisdiction as a geography
(`matchAddress(ix, { street, city, zip, muni })`) for rolls with no ZIP.

Consumers: OhioLiquorPermits (`react-app/scripts/geocode-permits.mjs`).
To do: make `voters-core/geocode-voters.mjs` import from here instead of
carrying its own copy of the same functions.

Source of truth: `FleetShareableCodeComponents/address-match/src`. Vendored
with `python scripts\sync-shared-code.py --lib address-match --apply`.
