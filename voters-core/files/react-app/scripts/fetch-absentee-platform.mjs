/**
 * Download a county's absentee / early-voting CSV from the state Board of
 * Elections platform, the way ~71 Ohio counties publish it:
 *
 *   https://lookup.boe.ohio.gov/vtrapp/<county>/avreport.aspx
 *
 *   node scripts/fetch-absentee-platform.mjs --county={{county}} --out=/tmp/absentee.csv
 *   node scripts/fetch-absentee-platform.mjs --county={{county}} --election=20261103G --out=...
 *   node scripts/fetch-absentee-platform.mjs --list --county={{county}}     # election codes
 *
 * With no --county the county is read from public/data/voters.json
 * ("{{COUNTY}} County, Ohio" -> "{{county}}"). With no --election the newest
 * election in the page's list is used. With no --out the file is written to
 * SourceData/<County>County_absentee <year> <kind>.csv, the name
 * convert-absentee.mjs expects.
 *
 * HOW THE SITE WORKS (as observed 23 Oct 2026, Mahoning)
 *
 * It is an ASP.NET WebForms app with no login and no CAPTCHA:
 *
 *   1. GET  avreport.aspx            -> the form, with __VIEWSTATE and a
 *                                       session cookie.
 *   2. POST avreport.aspx            -> every field as the browser would send
 *                                       it: the election code, grp_output =
 *                                       rdo_file (CSV), every "Achk_*" type
 *                                       and "Xchk_*" party box ticked, no
 *                                       date filter, no precinct/district
 *                                       filter, sort by precinct, btnStart.
 *                                       Redirects to
 *                                       underprocess.aspx?request=<id>.
 *   3. (underprocess.aspx polls with an UpdatePanel timer until the file is
 *      built. The build takes a second or two; the finished page can be
 *      fetched directly and simply retried until its download button exists.)
 *   4. GET  finished.aspx?request=<id> -> a form with btn_download.
 *   5. POST finished.aspx?request=<id> -> text/csv.
 *
 * The CSV comes back with a header row and one row per voter; see
 * scripts/lib/absentee.mjs for its columns. The page's "Election Absentee
 * data last updated" stamp is printed too, since it is the Board's own
 * version of the file and the check workflow can log it.
 *
 * Node 20+: uses the built-in fetch and a tiny cookie jar, no dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);

function countyFromVotersJson() {
  try {
    const d = JSON.parse(readFileSync(join(ROOT, "react-app", "public", "data", "voters.json"), "utf8"));
    return (String(d.county ?? "").match(/^(.+?) County/) ?? [])[1] ?? null;
  } catch {
    return null;
  }
}

const countyName = args.county
  ? args.county[0].toUpperCase() + args.county.slice(1).toLowerCase()
  : countyFromVotersJson();
if (!countyName) {
  console.error("Pass --county=<name> (e.g. --county={{county}}), or run where public/data/voters.json names the county.");
  process.exit(2);
}
const slug = countyName.toLowerCase().replace(/\s+/g, "");
const BASE = `https://lookup.boe.ohio.gov/vtrapp/${slug}/`;
const UA = `${countyName}CountyVoters absentee refresh (github.com/MikeCostarella)`;

// --------------------------------------------------------------- cookies ---

const jar = new Map();
function remember(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function request(url, init = {}) {
  const headers = { "User-Agent": UA, ...(init.headers ?? {}) };
  if (jar.size) headers.Cookie = cookieHeader();
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  remember(res);
  // Follow redirects by hand so the cookie jar sees every hop.
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    const next = new URL(res.headers.get("location"), url).toString();
    return request(next, { method: "GET" });
  }
  return res;
}

// ------------------------------------------------------------- the form ---

/** Hidden inputs, selects (first/selected option) and checkboxes of the first form. */
function parseForm(html) {
  const fields = [];
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = Object.fromEntries(
      [...m[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map((a) => [
        a[1].toLowerCase(),
        a[2] ?? a[3] ?? a[4] ?? "",
      ]),
    );
    if (!attrs.name) continue;
    const type = (attrs.type ?? "text").toLowerCase();
    fields.push({ name: attrs.name, type, value: decodeEntities(attrs.value ?? ""), checked: "checked" in attrs });
  }
  const selects = {};
  for (const m of html.matchAll(/<select\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => ({
      value: decodeEntities((o[1].match(/value\s*=\s*"([^"]*)"/i) ?? [])[1] ?? ""),
      text: decodeEntities(o[2].replace(/<[^>]+>/g, "").trim()),
      selected: /\bselected\b/i.test(o[1]),
    }));
    selects[m[1]] = options;
  }
  const action = (html.match(/<form\b[^>]*\baction\s*=\s*"([^"]*)"/i) ?? [])[1] ?? "";
  return { fields, selects, action };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ run ---

const started = Date.now();
console.log(`GET ${BASE}avreport.aspx`);
const r0 = await request(`${BASE}avreport.aspx`);
if (!r0.ok) throw new Error(`avreport.aspx: HTTP ${r0.status}`);
const page = await r0.text();
const form = parseForm(page);

const lastUpdated = (page.match(/last updated:?\s*([^<\n]+)/i) ?? [])[1]?.trim() ?? "";
if (lastUpdated) console.log(`  Board's stamp: data last updated ${lastUpdated}`);

const elections = (form.selects.cmbelectionlist ?? []).filter((o) => o.value !== "NONE");
if (elections.length === 0) throw new Error("No elections in cmbelectionlist - is this the right county slug?");
if (args.list === "true") {
  for (const e of elections) console.log(`  ${e.value}  ${e.text}`);
  process.exit(0);
}
const election = args.election ? elections.find((e) => e.value === args.election) : elections[0];
if (!election) throw new Error(`Election ${args.election} is not in the list; run with --list.`);
console.log(`  election: ${election.value} - ${election.text}`);

// Build the POST exactly as the browser sends the form with CSV + all types +
// all parties + no filters + precinct sort.
const body = new URLSearchParams();
for (const f of form.fields) {
  if (f.type === "hidden") body.append(f.name, f.value);
  else if (f.type === "checkbox" && /^(Achk_|Xchk_)/.test(f.name)) body.append(f.name, "on");
}
for (const [name, options] of Object.entries(form.selects)) {
  if (name === "cmbelectionlist") continue;
  const sel = options.find((o) => o.selected) ?? options[0];
  if (sel) body.append(name, sel.value);
}
body.set("cmbelectionlist", election.value);
// The page's own script copies the precinct range into these on load; the
// raw HTML has them empty. Unused with filter=nofilter, but sent as the
// browser would.
for (const [hid, sel] of [["hid_precfrom", "cmb_precfrom"], ["hid_precto", "cmb_precto"]]) {
  if (!body.get(hid) && form.selects[sel]?.[0]) body.set(hid, form.selects[sel][0].value);
}
body.append("grp_output", "rdo_file");
body.append("rdo_dtfilter", "rdo_dtno");
body.append("filter", "nofilter");
body.append("grp_sort", "rdo_palpha");
body.append("btnStart", "Start Processing");

console.log(`POST ${BASE}avreport.aspx (${[...body.keys()].length} fields)`);
const r1 = await request(`${BASE}avreport.aspx`, {
  method: "POST",
  body: body.toString(),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}avreport.aspx` },
});
const requestId = (new URL(r1.url).searchParams.get("request")) ?? (r1.url.match(/request=([^&]+)/) ?? [])[1];
if (!requestId) {
  const t = await r1.text();
  throw new Error(`Expected a redirect to underprocess.aspx?request=...; got ${r1.status} ${r1.url}\n${t.slice(0, 400)}`);
}
console.log(`  request id ${requestId}`);

// The file is built server-side in a second or two; poll the finished page.
let downloadForm = null;
for (let attempt = 1; attempt <= 40 && !downloadForm; attempt++) {
  await sleep(attempt === 1 ? 1500 : 3000);
  const rf = await request(`${BASE}finished.aspx?request=${requestId}`);
  const html = await rf.text();
  const f = parseForm(html);
  if (f.fields.some((x) => x.name === "btn_download")) {
    downloadForm = f;
    const size = (html.match(/total file size is:?\s*([^<\n]+)/i) ?? [])[1]?.trim();
    console.log(`  ready after ${attempt} poll(s)${size ? ` - ${size}` : ""}`);
  } else if (attempt % 5 === 0) {
    console.log(`  still processing (${attempt})...`);
  }
}
if (!downloadForm) throw new Error("The file was not ready after two minutes of polling finished.aspx.");

const dl = new URLSearchParams();
for (const f of downloadForm.fields) if (f.type === "hidden") dl.append(f.name, f.value);
dl.append("btn_download", "Download My File");
const r2 = await request(`${BASE}finished.aspx?request=${requestId}`, {
  method: "POST",
  body: dl.toString(),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}finished.aspx?request=${requestId}` },
});
const type = r2.headers.get("content-type") ?? "";
const buf = Buffer.from(await r2.arrayBuffer());
if (!/csv|octet-stream|text\/plain/i.test(type) || buf.length < 100) {
  throw new Error(`Download did not return a CSV (HTTP ${r2.status}, ${type}, ${buf.length} bytes):\n${buf.toString("utf8", 0, 300)}`);
}
const head = buf.toString("utf8", 0, 200);
if (!/CNTYIDNUM/.test(head)) throw new Error(`Downloaded file does not look like the platform CSV:\n${head}`);

// Where to put it. Default: SourceData/<County>County_absentee <year> <kind>.csv
let out = args.out;
if (!out) {
  const m = election.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\w+)/);
  const year = m ? m[3] : new Date().getFullYear();
  const kind = m ? m[4].toLowerCase() : "general";
  out = join(ROOT, "SourceData", `${countyName}County_absentee ${year} ${kind}.csv`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
const rows = buf.toString("utf8").split(/\r?\n/).filter(Boolean).length - 1;
console.log(`Wrote ${out}`);
console.log(`  ${buf.length.toLocaleString()} bytes, ${rows.toLocaleString()} voters, ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (lastUpdated) console.log(`::notice title=Absentee data::Board stamp: last updated ${lastUpdated}`);
