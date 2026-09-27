# FleetShareableCodeComponents

The source of truth for code shared across the Statehouse fleet. Right now that
means one library, **parcels-core**, which every `*CountyParcels` app vendors.

Until 27 September 2026 the master copy of parcels-core was whatever sat in
`FranklinCountyParcels/react-app/src/vendor/parcels-core`. That meant one
county app doubled as the library, and a stray edit there was indistinguishable
from a release. This repo ends that: the library is edited and tested here, and
only here.

## Layout

```
parcels-core/
  src/       -> copied to <county>/react-app/src/vendor/parcels-core/      (VERSION 1.10.0)
  scripts/   -> copied to <county>/react-app/scripts/vendor/parcels-core/  (VERSION 1.4.0)
test-harness/
  county.ts  -> stands in for an app's src/config/county.ts during tests
vitest.config.ts, package.json, .github/workflows/test.yml
```

`parcels-core/src/README.md` is the README that ships *inside* every app's
vendor tree. It tells app developers not to edit the vendored copy, which is
correct there. This repo is the one place those files *are* edited.

The two halves carry separate `VERSION` files and are versioned independently.
As of 1.10.0 the `scripts/` half lives only in Franklin; the other 87 apps have
not taken it yet (Statehouse issue #19).

## Making a change

1. Edit under `parcels-core/`. Keep the provenance comments (see the shipped
   README, "County names in comments").
2. Add or update the suite next to the code, then run it:
   ```powershell
   cd C:\projects\FleetShareableCodeComponents
   npm install
   npm test
   ```
3. Bump the `VERSION` of the half you changed (patch for a fix, minor for new
   behaviour).
4. Commit and push here. The `test` workflow must be green.
5. Sweep it into the fleet from Statehouse:
   ```powershell
   cd C:\projects\Statehouse
   python scripts\sync-parcels-core.py            # report only
   python scripts\sync-parcels-core.py --apply    # copy + md5-verify
   ```
   then commit the changed `*CountyParcels` repos through StatehouseUI.

Never fix a bug by editing an app's `vendor/parcels-core` directly. The next
sync overwrites it, and until then that app has silently drifted.

## Tests

`npm test` runs every `*.test.ts` / `*.test.mjs` under `parcels-core/`. They run
in plain Node with no browser, the same way they run inside an app.

The library's only link to its host app is the relative import
`../../../config/county`. `vitest.config.ts` aliases that import to
`test-harness/county.ts`, a copy of Franklin's config. The alias exists only
here; the apps have no path aliases on purpose.

There is no `tsc` typecheck here, because the relative seam can't be remapped for
`tsc`. The type check happens in every app's own `npm run build`.

## Future shared code

Anything else the fleet copies between repos by hand (the hamburger menu, build
stamp, contact config, ...) is a candidate for a sibling folder next to
`parcels-core/`, with its own `VERSION`, its own suites, and its own Statehouse
sync.
