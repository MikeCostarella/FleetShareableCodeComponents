/**
 * Fail the build if anything in public/data/ missed the service-worker
 * precache manifest.
 *
 * WHY THIS EXISTS
 *
 * Not for the size limit. Exceeding maximumFileSizeToCacheInBytes fails the
 * build loudly and names the file, which needs no help.
 *
 * The silent one is globPatterns. A data file whose extension is not listed
 * there is skipped with no warning and no failure at all - the build is green,
 * the app works online, and offline it is broken because the dataset was never
 * cached. That is not hypothetical: precinct-boundaries.geojson shipped
 * un-precached from the day the map was added, because the glob listed "json"
 * and not "geojson", and nothing anywhere said so.
 *
 * So rather than trusting the config to stay in step with what is in
 * public/data, check the actual output: every file there must appear in
 * dist/sw.js.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const DATA_DIR = join(APP, "public", "data");
const SW = join(APP, "dist", "sw.js");

let sw;
try {
  sw = readFileSync(SW, "utf8");
} catch {
  console.error(`\n  check-precache: no service worker at ${SW}.`);
  console.error("  Run this after `vite build`, not instead of it.\n");
  process.exit(1);
}

const missing = [];
for (const file of readdirSync(DATA_DIR)) {
  const url = `data/${file}`;
  if (!sw.includes(`"${url}"`)) {
    missing.push({ url, mb: statSync(join(DATA_DIR, file)).size / 1024 / 1024 });
  }
}

if (missing.length === 0) {
  console.log("  check-precache: every data file is in the precache manifest.");
  process.exit(0);
}

console.error("\n  check-precache: FILES MISSING FROM THE PRECACHE MANIFEST\n");
for (const m of missing) {
  console.error(`    ${m.url}  (${m.mb.toFixed(2)} MB)`);
}
console.error(
  "\n  The app will work online and have no offline mode.\n\n" +
    "  Check workbox.globPatterns in vite.config.ts covers these extensions -\n" +
    "  an unlisted one is skipped silently. (A file over\n" +
    "  maximumFileSizeToCacheInBytes fails the build before reaching here.)\n",
);
process.exit(1);
