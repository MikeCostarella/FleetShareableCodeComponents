# {{COUNTY}} County Ohio Voters

Searchable voter history for {{COUNTY}} County, Ohio: the county's registered voters with each one's election history since 2020, built from the Ohio Secretary of State's county voter file. One record per voter, carrying the elections they turned out for.

**Live site:** https://mikecostarella.github.io/{{REPO}}/

One of the *CountyVoters* apps. Its code comes from the shared library
[`FleetShareableCodeComponents/voters-core`](https://github.com/MikeCostarella/FleetShareableCodeComponents/tree/main/voters-core)
and is the same in every county apart from `react-app/src/config/county.ts` and
the county's name (see `react-app/VOTERS-CORE.md`). The features, the data
pipeline and the file formats are described in full in
[TrumbullCountyVoters' README](https://github.com/MikeCostarella/TrumbullCountyVoters#readme);
this one records {{COUNTY}}'s data.

## Data

<!-- Fill in from the convert-sos and geocode reports. -->

| | |
|---|---|
| Source | Ohio SoS county voter file, `SOS_{{COUNTY_SQUASHED_UPPER}}_<date>.txt` |
| Registered voters | |
| Elections kept | |
| Jurisdictions | |
| Placed on the map | |

**Early voting.** {{EARLY_VOTING}}

**What {{COUNTY}} does not have yet.** {{MISSING}}

## Refreshing

- **The roll:** download the county's file from <https://www6.ohiosos.gov/ords/f?p=VOTERFTP:HOME>, save it to `SourceData\SOS_{{COUNTY_SQUASHED_UPPER}}_<yyyy-mm-dd>.txt`, then (PowerShell)
  ```powershell
  cd C:\projects\{{REPO}}\react-app
  npm run convert:sos
  npm run build
  ```
- **Early voting:** see `react-app/scripts/refresh-absentee.ps1`.

## Local development (PowerShell)

```powershell
cd C:\projects\{{REPO}}\react-app
npm ci
npm run dev
```
