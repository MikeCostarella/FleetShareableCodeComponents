# voters-core

The shared code of the `<County>CountyVoters` apps (Trumbull, Mahoning,
Ashtabula, and the rest of Ohio per `Statehouse/design/county-voters.md`).

Unlike parcels-core, which is vendored into a `src/vendor/` folder, voters-core
**is the app**: `files/` mirrors a Voters repo's root, and the sweep renders
each file into each repo with the county's names filled in. Everything a county
needs of its own is listed in `files/react-app/VOTERS-CORE.md` (which ships
inside every app).

## Placeholders

Text files may use these, replaced exactly (so JSX `style={{ }}` and Actions
`${{ }}` are untouched):

| Token | Mahoning | Van Wert |
|---|---|---|
| `{{COUNTY}}` | Mahoning | Van Wert |
| `{{COUNTY_UPPER}}` | MAHONING | VAN WERT |
| `{{county}}` | mahoning | vanwert |
| `{{REPO}}` | MahoningCountyVoters | VanWertCountyVoters |
| `{{PKG}}` | mahoning-county-voters | van-wert-county-voters |

`.png` files are copied as they are.

**County names in comments.** Comments that record where something was
observed ("as observed 23 Oct 2026, Mahoning", "Thirty Trumbull VTDs") keep the
real county's name - they are provenance, true in every copy. Use a placeholder
only where the comment is about *this* app's county.

## Early-vote sources

Most Boards publish on the state platform, which `fetch-absentee-platform.mjs`
reads. A Board that posts a VoterView "Absent Voter Details" `.xls` on its own
site (Morrow) gets a `react-app/absentee-source.json` in its repo:

```json
{ "fetcher": "voterview", "url": "https://boe.<county>.gov/.../absent voter details.xls" }
```

`refresh-absentee.ps1` reads it and runs `fetch-absentee-voterview.mjs`, which
matches each ballot to the roll by name and house number (the report's AV ID
is not the county voter ID) and writes the same CSV layout the platform flow
produces, so nothing downstream changes.

A Board running Election Vault (Butler, Franklin) publishes two lists - by mail and in
person - and gets:

```json
{ "fetcher": "electionvault", "pageUrl": "https://.../ElectionVault/PublicRecords.aspx",
  "mailName": "Absentee by Mail Voter List (Current Election).csv",
  "inPersonName": "Absentee In-Person Voter List (Current Election).csv" }
```

`fetch-absentee-electionvault.mjs` loads the page, finds each list's download
link by its text and replays the ASP.NET postback the link makes (there is no
URL per file), then joins the two into one CSV in the state platform's layout (two Board
layouts so far, told apart by the header; their voter id is the county id, so
no name matching), with the Board's
challenge codes carried through as flags.

Hamilton's Board generates a CSV on request through a small API and gets
`{ "fetcher": "hamilton", "siteUrl": "https://votehamiltoncountyohio.gov" }`
for `fetch-absentee-hamilton.mjs` (ask for the current election, request the
export, download the file it names).

A Board whose site turns plain requests away (Hamilton is behind Cloudflare's
bot check, which no header can pass) or whose page is a JavaScript form gets

```json
{ "fetcher": "browser", "recipe": "hamilton", "siteUrl": "https://votehamiltoncountyohio.gov",
  "convert": "fetch-absentee-hamilton.mjs" }
```

`fetch-absentee-browser.mjs` drives headless Chromium (Playwright, installed
per app with `npm install --save-dev playwright; npx playwright install
chromium`) through the named recipe to get the Board's raw file, then the
named converter writes the platform-layout CSV. Playwright is not a
dependency of the app build; only the apps that need it install it.

The file is per-county and is not swept.

A Board whose page is a JavaScript form with nothing replayable behind it, or
that sits behind a bot check (Hamilton), gets a *recipe* in
`fetch-absentee-browser.mjs` plus its own converter:

```json
{ "fetcher": "browser", "recipe": "cuyahoga", "siteUrl": "https://boe.cuyahogacounty.gov",
  "convert": "fetch-absentee-cuyahoga.mjs" }
```

Playwright drives the machine's Chrome from the shared install under
`%LOCALAPPDATA%\FleetTools\playwright`; the recipe fills the form and catches
the download, the converter writes the platform-layout CSV. Recipes so far:
`hamilton` (WordPress API behind Cloudflare), `cuyahoga` (full-page POST form,
Oct 2026).

## Sweeping

```powershell
cd C:\projects\Statehouse
python scripts\sync-shared-code.py --lib voters-core                    # report
python scripts\sync-shared-code.py --lib voters-core --apply            # write + verify + commit plan
python scripts\sync-shared-code.py --lib voters-core --only Ashtabula   # one repo
```

Targets: every manifest repo with `"appKind": "Voters"`. A repo opts out of
individual files with `react-app/voters-core.json` → `exclude`, e.g.
Trumbull's VoterView workflow.

## A new county

```powershell
cd C:\projects\Statehouse
python scripts\new-county-voters.py Columbiana
```

renders this library into `C:\projects\ColumbianaCountyVoters`, copies the a11y
and basemaps vendor trees, writes `county.ts` from `ColumbianaCountyParcels`,
stubs the README and CHANGES, runs `git init`, and prints what is left.

## Making a change

1. Edit under `voters-core/files/`. Run a Voters app's build against it with
   `--only <County> --apply` first if the change is risky.
2. Bump `VERSION` (patch for a fix, minor for new behaviour).
3. Commit and push here, then sweep from Statehouse and commit each repo.

`react-app/src/vendor/parcels-core/` inside `files/` is a **frozen 1.9.0
subset** with one local change (`canvasRender.ts` takes `MapPoint[]`); the
parcels-core sweep does not target Voters repos, and this copy only moves when
it is edited here.
