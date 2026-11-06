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

Consumers: OhioLiquorPermits (`react-app/scripts/geocode-permits.mjs`).
To do: make `voters-core/geocode-voters.mjs` import from here instead of
carrying its own copy of the same functions.

Source of truth: `FleetShareableCodeComponents/address-match/src`. Vendored
with `python scripts\sync-shared-code.py --lib address-match --apply`.
