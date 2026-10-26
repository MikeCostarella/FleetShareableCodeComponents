/**
 * Download a Board of Elections' absentee list THROUGH A REAL BROWSER, for
 * Boards whose site turns away plain HTTP requests (Hamilton sits behind
 * Cloudflare's "Just a moment..." bot check, which fingerprints the TLS
 * connection itself - no header can pass it) or whose page is a JavaScript
 * form with no replayable request behind it. Headless Chromium via Playwright
 * loads the page like a person would, the check clears, and the page's own
 * JavaScript makes the calls.
 *
 * Each Board is a small RECIPE (below): what to do once the page is open. The
 * conversion of the downloaded file into the state platform's CSV layout
 * stays in the Board's own fetcher (fetch-absentee-hamilton.mjs --in=...),
 * so this script only has to get the file.
 *
 *   node scripts/fetch-absentee-browser.mjs --recipe=hamilton --site=https://votehamiltoncountyohio.gov --out=<raw file path>
 *   node scripts/fetch-absentee-browser.mjs --recipe=hamilton ... --headed      (watch it, for debugging)
 *
 * Needs Playwright, found in the first of these that has it:
 *   1. the app itself (node_modules/playwright)
 *   2. the folder named by the FLEET_PLAYWRIGHT_DIR environment variable
 *   3. %LOCALAPPDATA%\FleetTools\playwright  (one shared install for the whole
 *      fleet, so no app's package.json has to carry it). In PowerShell:
 *        mkdir "$env:LOCALAPPDATA\FleetTools\playwright"; cd "$env:LOCALAPPDATA\FleetTools\playwright"; npm init -y; npm install playwright
 * It drives the Google Chrome installed on the machine when there is one,
 * otherwise Playwright's own Chromium (npx playwright install chromium).
 *
 * Bot checks: the browser is launched without automation markers, and each
 * recipe keeps its own profile under %LOCALAPPDATA%\FleetTools\browser-profiles,
 * so a cleared Cloudflare check (its cf_clearance cookie) carries over to the
 * next run. If a headless run cannot clear it, run once with --headed, click
 * through the check in the window that opens, and the profile remembers it.
 *
 * refresh-absentee.ps1 runs this when absentee-source.json says
 *   { "fetcher": "browser", "recipe": "hamilton", "siteUrl": "...", "convert": "fetch-absentee-hamilton.mjs" }
 * and then runs the named converter with --in=<the raw file>.
 */
import { mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const OUT = args.out ? resolve(args.out) : null;
if (!OUT || !args.recipe || !args.site) {
  console.error("usage: fetch-absentee-browser.mjs --recipe=<name> --site=<board site url> --out=<raw file path> [--headed]");
  process.exit(2);
}

const LOCAL = process.env.LOCALAPPDATA || join(process.env.HOME || ".", ".local", "share");
const FLEET_TOOLS = join(LOCAL, "FleetTools");
const PLAYWRIGHT_DIRS = [
  dirname(fileURLToPath(import.meta.url)),
  process.env.FLEET_PLAYWRIGHT_DIR,
  join(FLEET_TOOLS, "playwright"),
].filter(Boolean);

let chromium, playwrightFrom;
for (const dir of PLAYWRIGHT_DIRS) {
  try {
    ({ chromium } = createRequire(join(dir, "package.json"))("playwright"));
    playwrightFrom = dir;
    break;
  } catch { /* try the next */ }
}
if (!chromium) {
  console.error("Playwright is not installed. One shared install serves every app - in PowerShell:\n" +
    `  mkdir "${join(FLEET_TOOLS, "playwright")}"; cd "${join(FLEET_TOOLS, "playwright")}"; npm init -y; npm install playwright`);
  process.exit(3);
}

const site = args.site.replace(/\/$/, "");
const say = (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

// ----------------------------------------------------------------- recipes ---

/**
 * Each recipe gets the open page and returns a Playwright Download (or a
 * Buffer). It should use the page's own form or API, not re-implement it.
 */
const RECIPES = {
  /**
   * Hamilton: /campaign-media/absentee-lists/ is a form over a small
   * WordPress API. Once Cloudflare clears, call the API from inside the page
   * (same origin, so the browser's cleared session is used): get-elections
   * for the current election, export-absentee-lists for a generated file
   * name, then navigate to download.php for it.
   */
  async hamilton(page) {
    await page.goto(`${site}/campaign-media/absentee-lists/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await clearCloudflare(page);
    const current = await page.evaluate(async () => {
      const r = await fetch("/wp-json/boe-api/v1/get-elections?all=true", { headers: { "X-Requested-With": "XMLHttpRequest" } });
      const list = await r.json();
      return list[0];
    });
    say(`election: ${current.Name} (${current.ElectionId})`);
    say("requesting the export (the server takes about half a minute)");
    const exported = await page.evaluate(async (electionId) => {
      const body = new URLSearchParams({
        exportMethod: "csv", ElectionId: String(electionId), Application: "", Exclude: "",
        RequestedStartDate: "", RequestedEndDate: "", pParty: "", OfficeCode: "", SortBy: "pn",
      });
      const r = await fetch("/wp-json/boe-api/v1/export-absentee-lists", {
        method: "POST", body,
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      });
      return r.json();
    }, current.ElectionId);
    if (!exported?.filename) throw new Error(`export gave no filename: ${JSON.stringify(exported).slice(0, 200)}`);
    say(`${exported.count?.toLocaleString?.() ?? exported.count} rows in ${exported.filename}`);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 180_000 }),
      page.evaluate((f) => { window.location.href = `/download.php?file=${encodeURIComponent(f)}`; }, exported.filename),
    ]);
    return download;
  },
};

/** Wait out Cloudflare's interstitial, if there is one. */
async function clearCloudflare(page) {
  const limit = args.headed ? 180 : 45;   // headed: time for a person to click through
  for (let i = 0; i < limit; i++) {
    const title = await page.title();
    if (!/just a moment|attention required|checking your browser/i.test(title)) {
      if (i > 0) say(`cleared after ${i} s`);
      return;
    }
    if (i === 0) say("Cloudflare check - waiting for it to clear" + (args.headed ? " (click the check in the window if it asks)" : ""));
    await page.waitForTimeout(1000);
  }
  throw new Error(`Cloudflare's check did not clear in ${limit} s` +
    (args.headed ? "" : " - run once with --headed, clear it by hand, and the browser profile will remember it"));
}

// --------------------------------------------------------------------- run ---

const recipe = RECIPES[args.recipe];
if (!recipe) {
  console.error(`no recipe "${args.recipe}"; known: ${Object.keys(RECIPES).join(", ")}`);
  process.exit(2);
}

const profileDir = join(FLEET_TOOLS, "browser-profiles", args.recipe);
mkdirSync(profileDir, { recursive: true });

/**
 * Launch a browser that looks like a person's: the installed Google Chrome if
 * there is one (its TLS and version fingerprint match real traffic), no
 * automation markers, a plain Chrome user agent, and a profile of its own
 * that keeps cookies between runs.
 */
async function launch(userAgent) {
  const options = {
    headless: !args.headed,
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1280, height: 900 },
    ...(userAgent ? { userAgent } : {}),
  };
  try {
    return [await chromium.launchPersistentContext(profileDir, { ...options, channel: "chrome" }), "Google Chrome"];
  } catch {
    return [await chromium.launchPersistentContext(profileDir, options), "Chromium"];
  }
}

say(`launching the browser${args.headed ? " (headed)" : ""} - Playwright from ${playwrightFrom}`);
let [context, flavour] = await launch();
let page = context.pages()[0] || await context.newPage();
const ua = await page.evaluate(() => navigator.userAgent);
if (/HeadlessChrome/.test(ua)) {
  await context.close();
  [context] = await launch(ua.replace("HeadlessChrome", "Chrome"));
  page = context.pages()[0] || await context.newPage();
}
say(`${flavour} ${ua.match(/Chrome\/(\d+)/)?.[1] || ""}, profile ${profileDir}`);
try {
  const result = await recipe(page);
  mkdirSync(dirname(OUT), { recursive: true });
  if (Buffer.isBuffer(result)) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT, result);
  } else {
    const failure = await result.failure();
    if (failure) throw new Error(`download failed: ${failure}`);
    const tmp = await result.path();
    if (existsSync(OUT)) { const { unlinkSync } = await import("node:fs"); unlinkSync(OUT); }
    renameSync(tmp, OUT);
  }
  const { statSync } = await import("node:fs");
  say(`saved ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB)`);
} finally {
  await context.close();
}
