# parcels-core — vendored library

**Do not edit anything in this directory.** It is machine-managed: every file
here is a byte-identical copy shipped to all `*CountyParcels` repos, and a local
edit will be silently overwritten by the next sync — or, worse, survive as the
kind of hand-drift this library exists to end.

A fix belongs in the library, released as a new version, and swept to the fleet
through a Statehouse commit plan. See `Statehouse/design/parcels-core.md`.

## What is in here

Shared behaviour for the county parcel maps: boundary fetching and the county
mask, the parcel loader (plain array and chunk manifest), geometry, filtering,
formatting, CSV export, canvas rendering, and the shared hooks and types.

Also `scripts/vendor/parcels-core/` — the build-pipeline half.

## What is NOT in here

Everything county-specific, which the app keeps:

- `src/config/county.ts` — name, FIPS, EPSG zone, valuation flag, statewide-key
  format. The library reads this and nothing else from the app, by relative
  path, and that is the entire seam.
- `src/config/contact.ts`, `src/data/mapsLink.ts` — county contact details and
  the Auditor deep-link.
- `src/data/parcelLookup.ts`, `src/data/parcelGeometry.ts` — the two live-source
  seams. The library ships the implementations (`liveLookupStatewide`,
  `liveLookupNone`, `liveGeometryStatewide`, `bakedGeometrySource`); these two
  files are where the county *picks* one, or writes its own against the
  contract in `data/liveLookup.ts` / `data/liveGeometry.ts`. Adams writes its
  own for both — its Auditor record shares three fields out of fifteen with the
  statewide one, and its polygons join on `PIN` rather than `LocalParcelID`,
  which is why both contracts are generic over the record and property shapes.
- `src/data/loadPoints.ts` — only when the county publishes columns the shared
  `Parcel` does not carry. The county wraps the library's loader with an
  `extend` callback and declares its own record type (Adams: `AdamsParcel`,
  adding census tract, food-desert flag and PIN). App code then imports that
  type — `import type { AdamsParcel as Parcel } from "../data/loadPoints"` —
  so the county's own fields are visible end to end. Counties with nothing
  extra import the library's loader and `Parcel` directly.

## Importing

Relative paths, both directions. App code reaches into the library:

```ts
import { loadPoints } from "./vendor/parcels-core/data/loadPoints";
import type { Parcel } from "./vendor/parcels-core/types/point";
```

and the library reaches back out for the four county constants:

```ts
import { AREA_BBOX, COUNTY_FIPS } from "../../../config/county";
```

**There are no path aliases, and there is no alias config to add.** An earlier
draft used `@core/*` and `@county/*` declared in `tsconfig.json` (`paths`) and
`vite.config.ts` (`resolve.alias`). That was abandoned: it pulled in
`@types/node` for `node:url` in the Vite config, and it meant two more files to
keep in step across 88 repos — two more chances for a sweep to half-land. If
you are migrating a county and looking for the alias configuration, stop; it
does not exist and adding it will only diverge that repo from the fleet.

## Tests

The suites ship with the code they cover and run from the app's own
`npm test`. They are what decides which behaviour is correct when versions
disagree — several encode bugs that cost real debugging time (the Greene
sliver, the 129-pins ring winding, the Delaware envelope).

## County names in comments

Comments throughout this library name specific counties — Greene's 243 sliver
parcels, Delaware's 129 misplaced pins, Franklin's 112 MB array that forced
chunking. Those are **provenance, not configuration**: they record where a
behaviour was discovered and what it cost, which is why the behaviour has
survived. Leave them.

What must never appear is a county name the code *acts* on. Those all come from
`config/county.ts`, and there are exactly five: `COUNTY_NAME`, `COUNTY_FIPS`,
`AREA_BBOX`, `HAS_VALUATION`, `STATE_PARCEL_KEY`.

`STATE_PARCEL_KEY` is the newest and the one most likely to be got wrong. It
says how this county's parcel number must be written in a statewide
`LocalParcelID='...'` WHERE clause — `"as-stored"`, `"stripped"`, or
`"not-applicable"` for the counties that never query that service. Every county
compiles `data/statewideLayer.ts` whether or not it calls it, which is why even
Adams declares the field. Settle it with one live query per format; a wrong
value does not throw, it returns nothing, which is indistinguishable from a
parcel with no statewide record. Four counties shipped that way before the
August 2026 sweep.
