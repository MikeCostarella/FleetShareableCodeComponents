// The scheduled-job run log (Statehouse data/job-runs/YYYY-MM.jsonl) as the
// History tab sees it: parse, work out how late each scheduled run started,
// and summarise per job. Pure functions; history.test.mjs pins them.
import { nextRuns } from "./cron.mjs";

export function parseRunLog(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, not fatal */ }
  }
  return out;
}

/** "2026-10" and the N-1 months before it, newest first. */
export function recentMonths(n, now = new Date()) {
  const out = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
}

/**
 * For each scheduled run, the cron time it was meant for (the latest
 * occurrence of any of its job's crons at or before it started) and the
 * delay in minutes. crons: Map("<fullName>/<file>" -> ["17 7 * * *", ...]).
 */
export function withDelay(entries, crons) {
  return entries.map((e) => {
    const exprs = crons.get(`${e.fullName}/${e.file}`);
    if (e.event !== "schedule" || !exprs?.length || !e.startedAt) return e;
    const start = new Date(e.startedAt);
    let best = null;
    for (const x of exprs) {
      try {
        for (const t of nextRuns(x, new Date(start.getTime() - 36 * 3_600_000), 48)) {
          if (t <= start && (!best || t > best)) best = t;
          if (t > start) break;
        }
      } catch { /* unparseable cron: no delay */ }
    }
    return best ? { ...e, scheduledFor: best.toISOString(), delayMin: Math.round((start - best) / 60_000) } : e;
  });
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** Per-job totals, busiest first: runs, scheduled/manual, results, data commits, typical delay. */
export function summarizeRuns(entries) {
  const jobs = new Map();
  for (const e of entries) {
    const id = `${e.fullName}/${e.file}`;
    const j = jobs.get(id) ?? { id, repo: e.repo, fullName: e.fullName, workflow: e.workflow, file: e.file,
      runs: 0, scheduled: 0, manual: 0, success: 0, failure: 0, other: 0, commits: 0, delays: [], lastRun: null, lastCommit: null };
    j.runs++;
    if (e.event === "schedule") j.scheduled++; else j.manual++;
    if (e.conclusion === "success") j.success++; else if (e.conclusion === "failure") j.failure++; else j.other++;
    if (e.commit) { j.commits++; if (!j.lastCommit || e.startedAt > j.lastCommit.startedAt) j.lastCommit = { ...e.commit, startedAt: e.startedAt }; }
    if (typeof e.delayMin === "number") j.delays.push(e.delayMin);
    if (!j.lastRun || e.startedAt > j.lastRun.startedAt) j.lastRun = e;
    jobs.set(id, j);
  }
  return [...jobs.values()]
    .map(({ delays, ...j }) => ({ ...j, medianDelayMin: median(delays) }))
    .sort((a, b) => b.runs - a.runs || a.repo.localeCompare(b.repo));
}

/**
 * Assemble a History response from the run log.
 *   readMonth(month) -> Promise<string | null>   (the YYYY-MM.jsonl text; null when missing)
 *   crons: Map("<fullName>/<file>" -> [expr...]) for start-delay; may be empty
 *   keep(entry) -> boolean                        (e.g. only one org's repos)
 */
export async function buildHistory({ readMonth, months = 3, crons = new Map(), keep = () => true, source = "", now = new Date() }) {
  const list = recentMonths(months, now);
  const texts = await Promise.all(list.map((m) => readMonth(m).catch(() => null)));
  const entries = texts.flatMap((t) => (t ? parseRunLog(t) : [])).filter(keep);
  const runs = withDelay(entries, crons);
  return { generated: now.toISOString(), months: list, source, runs, summary: summarizeRuns(runs) };
}
