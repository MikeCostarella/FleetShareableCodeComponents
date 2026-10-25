/**
 * ONLINE-ONLY DATA (voters-core 1.2.0, Oct 2026 - first used by Summit).
 *
 * The service worker precaches the app and its data at install, up to
 * PRECACHE_LIMIT per file. A big county's voters.json (Summit, Lucas,
 * Montgomery, Stark, Hamilton, Cuyahoga, Franklin...) is over it, so instead
 * of failing the build, vite.config.ts leaves such files out of the precache
 * and caches them at runtime the first time they load (NetworkFirst, cache
 * "voters-data"). The app shell still installs and opens offline; after one
 * online visit the data works offline too. Counties under the limit are
 * unchanged.
 *
 * Plain JavaScript on purpose: vite.config.ts is type-checked without Node's
 * type definitions, so the fs work lives here, typed by online-only.d.mts.
 * scripts/check-precache.mjs uses the same list.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Largest file precached at install (bytes). */
export const PRECACHE_LIMIT = 24 * 1024 * 1024;

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

/** File names in public/data/ over PRECACHE_LIMIT (empty before the first data build). */
export function onlineOnlyFiles() {
  try {
    return readdirSync(DATA_DIR).filter((f) => statSync(join(DATA_DIR, f)).size > PRECACHE_LIMIT);
  } catch {
    return [];
  }
}
