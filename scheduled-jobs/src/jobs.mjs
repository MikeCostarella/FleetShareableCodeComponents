// Scheduled GitHub Actions jobs for any set of repos, seen through `gh`.
//
//   const sj = createScheduledJobs({ runGh });
//   const jobs = await sj.jobsFor([{ fullName: "Org/Repo", label: "Repo", can: { toggle: true, run: true } }]);
//
// A target is read one of two ways:
//   - localDir set   -> crons come from the checkout on disk (StatehouseUI's
//                       fleet), and GitHub's copy is fetched to catch an edit
//                       that was never pushed;
//   - no localDir    -> everything comes from GitHub: the workflow list, each
//                       file's text, its state and runs (the course apps,
//                       which may not have a repo cloned at all).
//
// `runGh(args)` must resolve { ok, out, err } - the course apps' gh.mjs shape.
// Nothing here writes to a repo; toggle/dispatch are the only GitHub writes,
// and the caller decides (via `can`) who may use them.
import fs from "node:fs";
import path from "node:path";
import { describeCron, nextRuns } from "./cron.mjs";
import { WORKFLOW_FILE_RE, assessJob, parseWorkflow } from "./workflow.mjs";

export const DEFAULT_TZ = "America/New_York";

/** Every scheduled workflow in a local checkout: [{ file, name, crons, dispatchable }]. */
export function scanLocalDir(repoDir) {
  const dir = path.join(repoDir, ".github", "workflows");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => WORKFLOW_FILE_RE.test(f)); } catch { return []; }
  const out = [];
  for (const file of files.sort()) {
    let text;
    try { text = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    const wf = parseWorkflow(text);
    if (wf.crons.length) out.push({ file, ...wf });
  }
  return out;
}

const RUN_JQ = ".workflow_runs[0] | if . == null then null else {id, status, conclusion, event, createdAt: .created_at, updatedAt: .updated_at, url: .html_url} end";

export function createScheduledJobs({ runGh, tz = DEFAULT_TZ, concurrency = 4 } = {}) {
  if (typeof runGh !== "function") throw new Error("createScheduledJobs needs a runGh(args) function");

  async function api(args) {
    const r = await runGh(["api", ...args]);
    const text = `${r.err || ""}${r.out || ""}`;
    if (!r.ok) return { ok: false, err: text.trim().split("\n")[0], notFound: /404|Not Found/i.test(text) };
    try { return { ok: true, data: JSON.parse(r.out) }; } catch { return { ok: true, data: null }; }
  }

  const decode = (b64) => Buffer.from(String(b64).replace(/\s+/g, ""), "base64").toString("utf8");

  async function repoInfo(fullName) {
    const r = await api([`repos/${fullName}`, "--jq", "{pushedAt: .pushed_at, private: .private, fork: .fork, defaultBranch: .default_branch, parent: .parent.full_name}"]);
    return r.ok ? r.data : null;
  }

  /** The repo's scheduled workflows as GitHub has them (default branch). */
  async function remoteWorkflows(fullName) {
    const list = await api([`repos/${fullName}/actions/workflows?per_page=100`, "--jq", "[.workflows[] | {path, name, state, url: .html_url}]"]);
    if (!list.ok) return { ok: false, err: list.err, workflows: [] };
    const candidates = (list.data || []).filter((w) => w.path?.startsWith(".github/workflows/") && WORKFLOW_FILE_RE.test(path.posix.basename(w.path)));
    const workflows = [];
    for (const w of candidates) {
      const c = await api([`repos/${fullName}/contents/${w.path}`, "--jq", ".content"]);
      if (!c.ok || typeof c.data !== "string") continue;
      const wf = parseWorkflow(decode(c.data));
      if (wf.crons.length) workflows.push({ file: path.posix.basename(w.path), ...wf, name: wf.name || w.name, state: w.state, url: w.url });
    }
    return { ok: true, workflows };
  }

  function describe(crons, now) {
    return crons.map((c) => {
      try {
        const d = describeCron(c.expr, tz, now);
        return { ...c, text: d.text, utc: d.utc, next: nextRuns(c.expr, now, 1)[0]?.toISOString() ?? null };
      } catch (e) {
        return { ...c, error: e.message, text: "unparseable", utc: "", next: null };
      }
    });
  }

  async function buildJob(target, wf, info, now, fromDisk) {
    const fullName = target.fullName;
    const crons = describe(wf.crons, now);
    const upcoming = crons
      .filter((c) => !c.error)
      .flatMap((c) => nextRuns(c.expr, now, 3))
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map((d) => d.toISOString());
    const wfPath = `.github/workflows/${wf.file}`;
    const branch = info?.defaultBranch || "main";
    const job = {
      id: `${fullName}/${wf.file}`,
      repo: target.label || fullName.split("/")[1],
      fullName,
      role: target.role || null,
      source: fromDisk ? "disk" : "github",
      file: wf.file,
      path: wfPath,
      name: wf.name || wf.file,
      dispatchable: wf.dispatchable,
      slug: fullName,
      repoUrl: `https://github.com/${fullName}`,
      actionsUrl: `https://github.com/${fullName}/actions/workflows/${wf.file}`,
      editUrl: `https://github.com/${fullName}/edit/${branch}/${wfPath}`,
      pagesUrl: target.pagesUrl ?? null,
      crons,
      next: upcoming[0] ?? null,
      upcoming,
      state: wf.state ?? "unknown",
      lastScheduled: null,
      lastRun: null,
      repoInfo: info,
      remoteCrons: null,
      can: { toggle: false, run: false, edit: true, ...(target.can || {}) },
    };

    const base = `repos/${fullName}/actions/workflows/${wf.file}`;
    const calls = [
      api([`${base}/runs?per_page=1&event=schedule`, "--jq", RUN_JQ]),
      api([`${base}/runs?per_page=1`, "--jq", RUN_JQ]),
    ];
    if (fromDisk) {
      calls.push(api([base, "--jq", "{state, url: .html_url}"]));
      calls.push(api([`repos/${fullName}/contents/${wfPath}`, "--jq", ".content"]));
    }
    const [sched, any, state, content] = await Promise.all(calls);
    if (sched.ok) job.lastScheduled = sched.data;
    if (any.ok) job.lastRun = any.data;
    if (fromDisk) {
      if (state.ok && state.data) job.state = state.data.state;
      else if (state.notFound) job.state = "not-on-github";
      if (content.ok && typeof content.data === "string") job.remoteCrons = parseWorkflow(decode(content.data)).crons.map((c) => c.expr);
    }
    job.can.run = job.can.run && job.dispatchable;
    job.warnings = assessJob(job, nextRuns, { now, tz });
    return job;
  }

  async function mapPool(items, fn) {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
  }

  /**
   * Scheduled jobs for the given targets, sorted by next run.
   * Returns { jobs, errors: [{ fullName, error }] } - one unreachable repo
   * never hides the others.
   */
  async function jobsFor(targets, { now = new Date() } = {}) {
    const errors = [];
    const perRepo = await mapPool(targets, async (t) => {
      try {
        const info = t.repoInfo ?? (await repoInfo(t.fullName));
        if (t.localDir) {
          const wfs = scanLocalDir(t.localDir);
          return Promise.all(wfs.map((wf) => buildJob(t, wf, info, now, true)));
        }
        const remote = await remoteWorkflows(t.fullName);
        if (!remote.ok) { errors.push({ fullName: t.fullName, error: remote.err || "could not list workflows" }); return []; }
        return Promise.all(remote.workflows.map((wf) => buildJob(t, wf, info, now, false)));
      } catch (e) {
        errors.push({ fullName: t.fullName, error: String(e?.message || e) });
        return [];
      }
    });
    const jobs = perRepo.flat();
    jobs.sort((a, b) => (a.next ?? "9").localeCompare(b.next ?? "9"));
    return { jobs, errors };
  }

  async function toggle(fullName, file, enabled) {
    const r = await runGh(["workflow", enabled ? "enable" : "disable", file, "--repo", fullName]);
    return r.ok ? { ok: true } : { ok: false, error: (r.err || r.out || "gh failed").trim() };
  }

  async function dispatch(fullName, file) {
    const r = await runGh(["workflow", "run", file, "--repo", fullName]);
    return r.ok ? { ok: true } : { ok: false, error: (r.err || r.out || "gh failed").trim() };
  }

  return { jobsFor, toggle, dispatch, repoInfo, remoteWorkflows };
}
