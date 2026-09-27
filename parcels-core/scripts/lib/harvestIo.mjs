/**
 * Resume and checkpoint plumbing for the harvest scripts (Statehouse #10).
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * Every lineage-A script checkpointed like this:
 *
 *     offset += features.length;
 *     if (offset % (PAGE * 10) === 0) writeFileSync(OUT, ...);
 *
 * `offset` is only ever a multiple of PAGE while every page returns exactly
 * PAGE features. The moment one page comes back short — the very condition the
 * id sweep exists to handle — `offset % (PAGE * N)` can never be 0 again and no
 * further checkpoint is written for the rest of the run. On a *resumed* run it
 * is worse: offset is seeded from a record count that is not a multiple of
 * PAGE, so the run never checkpoints at all. The stated intent — "flush
 * periodically so an interruption costs one page, not the whole run" — was
 * never met on any run that needed it.
 *
 * A counter that only ever increases, compared against a threshold, cannot
 * develop that fault.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Write via a temp file and rename, so an interrupt during a multi-megabyte
 * JSON.stringify cannot leave a truncated harvest that the next resume reads
 * as "already on disk".
 */
export function atomicWrite(path, text) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

/** Load a partial harvest, unless --restart was passed or the file is junk. */
export function loadResume(path, { restart = false, log = console.log, warn = console.warn } = {}) {
  if (restart || !existsSync(path)) return { records: [], resumed: false };
  try {
    const records = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(records)) throw new Error("not an array");
    log(`Resuming: ${records.length.toLocaleString()} already on disk.`);
    return { records, resumed: true };
  } catch {
    warn("Existing harvest file unreadable; starting fresh.");
    return { records: [], resumed: false };
  }
}

/**
 * Flush every `everyFeatures` features consumed, counted — never inferred from
 * an offset's divisibility.
 *
 *   const cp = makeCheckpointer(OUT, () => records, { everyFeatures: 30_000 });
 *   ...
 *   cp.advance(features.length);   // flushes when the threshold is crossed
 *   cp.flush();                    // unconditional, at the end of a phase
 */
export function makeCheckpointer(path, getRecords, { everyFeatures = 30_000, write = atomicWrite } = {}) {
  let sinceFlush = 0;
  let flushes = 0;
  const save = () => {
    write(path, JSON.stringify(getRecords()));
    flushes++;
  };
  const flush = () => {
    save();
    sinceFlush = 0;
  };
  return {
    advance(n = 1) {
      sinceFlush += n;
      // Subtract rather than reset: a page larger than the threshold must not
      // silently discard its remainder and delay the next flush.
      if (sinceFlush >= everyFeatures) {
        save();
        sinceFlush -= everyFeatures;
      }
      return sinceFlush;
    },
    flush,
    get flushes() {
      return flushes;
    },
    get pending() {
      return sinceFlush;
    },
  };
}
