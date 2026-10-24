# This app is built from voters-core

Almost every file in this repo comes from the shared library
**`FleetShareableCodeComponents/voters-core`** and is the same in every
`<County>CountyVoters` app, with the county's name filled in. Do not edit those
files here: the next sweep overwrites them. Edit the library and sweep:

```powershell
cd C:\projects\Statehouse
python scripts\sync-shared-code.py --lib voters-core              # report
python scripts\sync-shared-code.py --lib voters-core --apply      # write
```

## What belongs to this county, not to the library

| File | What it holds |
|---|---|
| `react-app/src/config/county.ts` | name, FIPS, map box and centre (from `<County>CountyParcels`) |
| `README.md`, `CHANGES.md` | this county's data notes and history |
| `SourceData/` | the SoS file and the absentee CSV |
| `react-app/public/data/` | `voters.json` and any county data (e.g. precinct boundaries) |
| `react-app/src/vendor/a11y`, `vendor/basemaps` | swept by their own libraries |
| `react-app/voters-core.json` | the library version last swept in, and any library files this repo opts out of (`exclude`) |

A county whose Board does not use the state platform (Trumbull, today) keeps
its own `check-absentee.yml` and lists it, with the two `.ps1` scripts, under
`exclude`.
