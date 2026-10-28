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
 *   node scripts/fetch-absentee-browser.mjs --recipe=cuyahoga --site=https://boe.cuyahogacounty.gov --out=<raw file path>
 *   node scripts/fetch-absentee-browser.mjs --recipe=tedvault --site=https://votertools.woodcountyohio.gov --out=<raw file path>
 *   node scripts/fetch-absentee-browser.mjs --recipe=stark --site=https://builder1.revize.com --out=<raw folder path>
 *     (a recipe that returns several files - Stark's Returned + daily Mailed
 *     spreadsheets - saves them into --out as a folder; its converter takes --in=<that folder>)
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
import { mkdirSync, renameSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

  /**
   * Cuyahoga: /candidates/Get-Vote-by-Mail-Labels-and-Lists is a plain form
   * that POSTs to .../GetAbsenteeData and answers with the CSV. No bot check
   * guards it (the reCAPTCHA badge on the page belongs to the "Was this page
   * helpful?" widget), but it is a JavaScript form: the district list only
   * appears after a district type is chosen, both dates are required, and
   * the submit is a full-page POST, so a real browser is the simplest replay.
   * Fills the form the way a person does (recorded 26 Oct 2026): the newest
   * election, Date Issued from 1 January of its year to today, all parties,
   * County Wide, CSV - every ballot of the election, returned or not. The
   * download is Export-<yyyymmdd>-<hhmmss>.csv; fetch-absentee-cuyahoga.mjs
   * converts it.
   */
  async cuyahoga(page) {
    await page.goto(`${site}/candidates/Get-Vote-by-Mail-Labels-and-Lists`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    // <option>s are never "visible" to Playwright while the list is closed: wait for them to exist.
    await page.waitForSelector("#ElectionInfoDDL option:nth-child(2)", { state: "attached", timeout: 60_000 });
    // Options are "269|NOVEMBER 3, 2026 GENERAL ELECTION|GEN"; the first real one is the newest.
    const election = await page.$eval("#ElectionInfoDDL option:nth-child(2)", (o) => ({ value: o.value, text: o.textContent.trim() }));
    say(`election: ${election.text}`);
    const year = (election.text.match(/\b(20\d\d)\b/) || [])[1] || String(new Date().getFullYear());
    const today = new Date();
    const mdy = (m, d, y) => `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
    await page.selectOption("#ElectionInfoDDL", election.value);
    await page.fill("#DateIssuedFrom", mdy(1, 1, year));
    await page.fill("#DateIssuedTo", mdy(today.getMonth() + 1, today.getDate(), today.getFullYear()));
    await page.selectOption("#PartyDDL", "99");                 // All
    await page.selectOption("#DistrictTypeDDL", "ALL");         // County Wide - shows the district list
    await page.waitForSelector("#DistrictDDL option[value='2']", { state: "attached", timeout: 30_000 });
    await page.selectOption("#DistrictDDL", "2");               // COUNTY WIDE DISTRICT(ALL) - shows the precinct list
    await page.waitForFunction(() => document.querySelector("#PrecinctDDL")?.options.length > 0, null, { timeout: 30_000 });
    await page.check("input[name='selectFormat'][value='ForCSV']");
    await page.waitForSelector("#btnExportData", { state: "visible", timeout: 15_000 });
    say("requesting the CSV (the server takes a little while for the whole county)");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 300_000 }),
      page.click("#btnExportData"),
    ]);
    say(`download: ${download.suggestedFilename()}`);
    return download;
  },

  /**
   * Stark: the Board's absentee spreadsheets sit on the county website's CMS
   * host behind a sign-in form on the page (the shared candidate login from
   * the Board's guide, filed under "stark-absentee" in
   * %LOCALAPPDATA%\Statehouse\secrets.json) and Cloudflare, which turns plain
   * requests away. The page lists "Absentee
   * Ballots Returned" (cumulative) and one "Absentee Ballots Mailed <date>"
   * per day; every one is downloaded and returned as a set of files for
   * fetch-absentee-stark.mjs --in=<folder>.
   */
  async stark(page) {
    await page.goto(`${site}/revize/starkcountyoh/government/offices/board_of_elections/absentee_download.php`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await clearCloudflare(page);
    // The page itself carries the sign-in form ("Sign in to view this page":
    // user / pass / Remember me); the profile keeps the session afterwards,
    // so the form is only there on the first run or after it expires.
    if (await page.$("input[name='pass']")) {
      const { username, password } = starkLogin();
      say("signing in");
      await page.fill("input[name='user']", username);
      await page.fill("input[name='pass']", password);
      const remember = await page.$("input[name='rememberMe']");
      if (remember && !(await remember.isChecked())) await remember.check();
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        page.click("button:has-text('Sign in'), input[type='submit'], button[type='submit']"),
      ]);
      await page.waitForTimeout(1500);
      await clearCloudflare(page);
      if (await page.$("input[name='pass']")) {
        const text = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ").slice(0, 300);
        throw new Error(`the Board's page did not accept the login in %LOCALAPPDATA%\\Statehouse\\secrets.json ("stark-absentee"): ${text}`);
      }
    }
    const links = (await page.$$eval("a[href]", (as) => as.map((a) => ({ text: (a.textContent || "").replace(/\s+/g, " ").trim(), href: a.href }))))
      .filter((l) => /absentee ballots (returned|mailed)/i.test(l.text));
    if (!links.some((l) => /returned/i.test(l.text))) {
      // Say what was there instead: the URL we ended on, the title, any
      // form fields (an HTML sign-in form?), the first lines of text, and a
      // screenshot beside --out.
      const title = await page.title();
      const url = page.url();
      const inputs = await page.$$eval("input", (is) => is.map((i) => `${i.type}:${i.name || i.id || "?"}`));
      const text = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ").slice(0, 400);
      try { mkdirSync(dirname(OUT), { recursive: true }); await page.screenshot({ path: `${OUT}.png`, fullPage: true }); } catch { /* best effort */ }
      throw new Error(`no "Absentee Ballots Returned" link on the page.\n  url: ${url}\n  title: ${title}\n  inputs: ${inputs.join(", ") || "none"}\n  text: ${text}\n  screenshot: ${OUT}.png`);
    }
    say(`${links.length} spreadsheet(s) linked (${links.filter((l) => /mailed/i.test(l.text)).length} daily Mailed + Returned)`);
    const files = [];
    for (const l of links) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.evaluate((h) => { window.location.href = h; }, l.href),
      ]);
      const failure = await download.failure();
      if (failure) throw new Error(`${l.text}: download failed: ${failure}`);
      files.push({ name: download.suggestedFilename() || `${l.text}.xlsx`, buffer: readFileSync(await download.path()) });
    }
    return files;
  },

  /**
   * Clermont: two no-login forms under /BOECandidateTool/Home, each a POST
   * that answers with an .xlsx. BallotTracking (election + date range) is the
   * VoterView-layout list of RETURNED ballots; AbsenteeMailingLabel (election,
   * party, show-party, date range, district, format, procedure) with EXCEL +
   * COUNTYWIDE + All is every ballot REQUESTED. Both into a folder for
   * fetch-absentee-clermont.mjs --in=<folder>. Dates: 1 Jan this year to today.
   */
  async clermont(page) {
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const start = iso(new Date(today.getFullYear(), 0, 1)), end = iso(today);
    const files = [];
    const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    /** The newest election in the page's <select> ("2026 November General" -> 2026-11). */
    const newestElection = async () => {
      const opts = await page.$$eval("select option", (os) => os.map((o) => ({ value: o.value, text: o.textContent.trim() })));
      const dated = opts.map((o) => { const m = o.text.match(/^(\d{4})\s+([A-Za-z]+)/); const mo = m ? MONTHS.indexOf(m[2].toUpperCase()) : -1; return mo < 0 ? null : { ...o, key: Number(m[1]) * 100 + mo }; }).filter(Boolean);
      if (!dated.length) throw new Error(`no dated election option on ${page.url()}: ${opts.map((o) => o.text).join(" | ")}`);
      dated.sort((x, y) => y.key - x.key);
      return dated[0];
    };
    /** Navigate to a report URL and catch the .xlsx it answers with. */
    const getReport = async (label, url) => {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 180_000 }),
        page.evaluate((u) => { window.location.href = u; }, url),
      ]);
      const failure = await download.failure();
      if (failure) throw new Error(`${label}: download failed: ${failure} (${url})`);
      files.push({ name: download.suggestedFilename() || `${label}.xlsx`, buffer: readFileSync(await download.path()) });
      say(`${label}: ${download.suggestedFilename()}`);
    };

    // The forms are plain GETs (seen in the address bar, 27 Oct 2026), so once
    // the election id is read off the page the reports are fetched by URL.
    await page.goto(`${site}/BOECandidateTool/Home/BallotTracking`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await clearCloudflare(page);
    const election = await newestElection();
    say(`election: ${election.text} (${election.value})`);
    await getReport("ballot-tracking", `${site}/BOECandidateTool/Home/GenerateBallotTracking?SelectedElection=${election.value}&SelectedStartDate=${start}&SelectedEndDate=${end}`);

    // The mailing-label form: fill it through its own controls (by name,
    // read off the page) and let the page submit, so the real action URL and
    // parameter encoding come from the Board's code, not a guess. The form
    // enables Generate Report only after its listeners see each change.
    await page.goto(`${site}/BOECandidateTool/Home/AbsenteeMailingLabel`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await clearCloudflare(page);
    const fields = await page.$$eval("form select, form input", (els) => els.map((el) => ({ name: el.name, id: el.id, tag: el.tagName.toLowerCase(), type: el.type, options: el.tagName === "SELECT" ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null })));
    const field = (re) => { const f = fields.find((x) => re.test(x.name) || re.test(x.id)); if (!f) throw new Error(`mailing-label form has no field matching ${re}; fields: ${fields.map((x) => x.name || x.id).join(", ")}`); return f; };
    const setSelect = async (re, optRe) => {
      const f = field(re);
      const opt = f.options.find((o) => optRe.test(o.text));
      if (!opt) throw new Error(`${f.name}: no option matching ${optRe}: ${f.options.map((o) => o.text).join(" | ")}`);
      await page.selectOption(`[name="${f.name}"]`, opt.value);
      await page.$eval(`[name="${f.name}"]`, (el) => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
      say(`  ${f.name} = ${opt.text}`);
    };
    const setDate = async (re, value) => {
      const f = field(re); const sel = `[name="${f.name}"]`;
      await page.focus(sel);
      if (f.type === "date") await page.fill(sel, value);
      else { await page.fill(sel, ""); await page.type(sel, value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"), { delay: 20 }); }
      await page.$eval(sel, (el) => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); el.blur(); });
    };
    await setSelect(/election/i, new RegExp(election.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    await setSelect(/^(?!.*show).*party/i, /^ALL/i);
    await setSelect(/show/i, /party and precinct/i);
    await setDate(/start/i, start);
    await setDate(/end/i, end);
    await setSelect(/district/i, /countywide/i);
    await setSelect(/format/i, /excel/i);
    await setSelect(/procedure/i, /^all$/i);
    const btn = "button[type='submit'], input[type='submit']";
    try { await page.waitForFunction((b) => { const el = document.querySelector(b); return el && !el.disabled; }, btn, { timeout: 15_000 }); }
    catch { await page.$eval(btn, (el) => { el.disabled = false; }); say("absentee-mailing: the page never enabled Generate Report - submitting anyway"); }
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 180_000 }),
      page.click(btn),
    ]);
    const failure = await download.failure();
    if (failure) throw new Error(`absentee-mailing: download failed: ${failure}`);
    files.push({ name: download.suggestedFilename() || "absentee-mailing.xlsx", buffer: readFileSync(await download.path()) });
    say(`absentee-mailing: ${download.suggestedFilename()}`);
    return files;
  },
  /**
   * TED Election Vault (Wood, Oct 2026): <site>/TEDElectionLink/ElectionVault/files
   * is a Blazor Server page (MudBlazor), so the CSV is built over the page's
   * SignalR connection and handed to the browser as a download - there is no
   * URL to request, hence a real browser. Done the way a person does it
   * (recorded 28 Oct 2026): "Go to Absentee List", tick Issued + Printed +
   * Returned in the Absentee Status list (Issued is ticked already), leave
   * party and district blank (the whole county), Download CSV. The file is
   * absentee-list-<yyyy-mm-dd>.csv; fetch-absentee-tedvault.mjs converts it.
   *
   * The page loads Google reCAPTCHA. The download asked for nothing in a
   * person's browser on 28 Oct 2026; if a run is ever shown a challenge, this
   * recipe stops and says so - it does not try to answer it. Ask the Board
   * for another route then.
   */
  async tedvault(page) {
    await page.goto(`${site}/TEDElectionLink/ElectionVault/files`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const challenged = async () => (await page.$("iframe[src*='recaptcha'][src*='bframe']")) && (await page.isVisible("iframe[src*='recaptcha'][src*='bframe']"));
    await page.click("button[aria-label='Go to Absentee List']", { timeout: 60_000 });
    const status = page.locator(".mud-input-control", { hasText: "Absentee Status" }).first();
    await status.waitFor({ timeout: 60_000 });
    // The list opens from the control's end adornment; its options are rows
    // of a checkbox and a <p> label inside the open popover.
    await status.locator(".mud-input-adornment-end button").last().click();
    const pop = page.locator(".mud-popover-open").last();
    await pop.waitFor({ timeout: 15_000 });
    const want = ["Issued", "Printed", "Returned"];
    for (const label of want) {
      const row = pop.locator("div.d-flex.align-center", { has: page.locator(`p:text-is("${label}")`) }).first();
      const box = row.locator("input[type='checkbox']");
      if (!(await box.count())) throw new Error(`tedvault: no "${label}" in the Absentee Status list - the page changed`);
      if (!(await box.isChecked())) await row.locator(`p:text-is("${label}")`).click();   // the label toggles it (the input itself is transparent)
    }
    const ticked = await pop.evaluate((el) => [...el.querySelectorAll("input[type=checkbox]")].map((c) => ({
      label: (c.closest("div.d-flex")?.querySelector("p")?.textContent || "").trim(), on: c.checked,
    })).filter((c) => c.on && c.label !== "Select All").map((c) => c.label));
    say(`absentee status: ${ticked.join(", ")}`);
    if (want.some((w) => !ticked.includes(w))) throw new Error(`tedvault: could not tick ${want.filter((w) => !ticked.includes(w)).join(", ")}`);
    await page.mouse.click(10, 400);   // close the list (Escape does not)
    await pop.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    say("requesting the CSV");
    let download;
    try {
      [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 180_000 }),
        page.locator("button", { hasText: "Download CSV" }).first().click(),
      ]);
    } catch (e) {
      if (await challenged()) throw new Error("tedvault: the page showed a reCAPTCHA challenge - not answered by design; ask the Board for another route");
      throw e;
    }
    const failure = await download.failure();
    if (failure) throw new Error(`tedvault: download failed: ${failure}`);
    say(`download: ${download.suggestedFilename()}`);
    return download;
  },
};

/** The Board's candidate login, from the secrets file outside every repo (or the environment). */
function starkLogin() {
  const secrets = join(LOCAL, "Statehouse", "secrets.json");
  if (process.env.STARK_ABSENTEE_USER && process.env.STARK_ABSENTEE_PASS) {
    return { username: process.env.STARK_ABSENTEE_USER, password: process.env.STARK_ABSENTEE_PASS };
  }
  try {
    const s = JSON.parse(readFileSync(secrets, "utf8"))["stark-absentee"];
    if (s?.user && s?.pass) return { username: s.user, password: s.pass };
  } catch { /* reported below */ }
  throw new Error(`no Stark login: add "stark-absentee": { "user": "...", "pass": "..." } to ${secrets}`);
}

/** Per-recipe browser-context options (none yet; a recipe needing HTTP auth would add httpCredentials here). */
const RECIPE_CONTEXT = {};

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
    ...(RECIPE_CONTEXT[args.recipe]?.() ?? {}),
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
  if (Array.isArray(result)) {
    // Several files: OUT is a folder, emptied first so a day that vanished
    // from the Board's archive does not linger.
    const { rmSync } = await import("node:fs");
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    for (const f of result) writeFileSync(join(OUT, f.name.replace(/[\\/:*?"<>|]/g, "_")), f.buffer);
    say(`saved ${result.length} file(s) into ${OUT}`);
  } else if (Buffer.isBuffer(result)) {
    writeFileSync(OUT, result);
  } else {
    const failure = await result.failure();
    if (failure) throw new Error(`download failed: ${failure}`);
    const tmp = await result.path();
    if (existsSync(OUT)) { const { unlinkSync } = await import("node:fs"); unlinkSync(OUT); }
    renameSync(tmp, OUT);
  }
  if (!Array.isArray(result)) {
    const { statSync } = await import("node:fs");
    say(`saved ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB)`);
  }
} finally {
  await context.close();
}
