// Reading a workflow file, and judging a scheduled job: pure functions, no I/O.
// jobs.mjs does the fetching; this decides what the panel should warn about.

/** Workflow files the scanners consider. */
export const WORKFLOW_FILE_RE = /^[\w.-]+\.ya?ml$/;

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** { name, crons: [{ expr, comment }], dispatchable } from a workflow's text. */
export function parseWorkflow(text) {
  const nameM = String(text).match(/^name:\s*(.+?)\s*$/m);
  const crons = [];
  const re = /^\s*-\s*cron:\s*(["'])(.+?)\1\s*(?:#\s*(.*))?$/gm;
  let m;
  while ((m = re.exec(text))) crons.push({ expr: m[2].trim(), comment: (m[3] || "").trim() });
  return {
    name: nameM ? unquote(nameM[1].replace(/\s+#.*$/, "")) : null,
    crons,
    dispatchable: /^\s*workflow_dispatch\s*:?/m.test(text),
  };
}

const DAY_MS = 86_400_000;
const INACTIVITY_DAYS = 60; // GitHub's rule for public repos
const INACTIVITY_WARN_DAYS = 45;
const MISSED_GRACE_MS = 3 * 3_600_000; // GitHub can start scheduled runs late

/**
 * Warnings for one job, most serious first: [{ level: "error"|"warn"|"info", text }].
 *
 * `job` needs: state, crons [{expr, error?}], lastScheduled {conclusion, createdAt}?,
 * repoInfo {pushedAt, private, fork}?, remoteCrons [expr]? (only when the
 * crons were read from a local checkout - compares it with GitHub's copy).
 * `nextRunsFn` is cron.mjs's nextRuns (passed in to keep this file pure).
 */
export function assessJob(job, nextRunsFn, { now = new Date(), tz = "America/New_York" } = {}) {
  const w = [];
  const say = (level, text) => w.push({ level, text });
  const isFork = !!job.repoInfo?.fork;

  if (job.crons.some((c) => c.error)) say("error", "A cron line could not be parsed - GitHub will reject or ignore it.");

  switch (job.state) {
    case "disabled_inactivity":
      say("error", "GitHub disabled this for inactivity (60 days without a commit). Enable it to resume.");
      break;
    case "disabled_manually":
      say("warn", "Disabled - scheduled runs are not happening.");
      break;
    case "disabled_fork":
      say("info", "GitHub turns scheduled workflows off in forks. Enable it to run it on your fork (it then checks YOUR copy, not the class's).");
      break;
    case "not-on-github":
      say("warn", "This workflow is on disk but not on GitHub yet - commit and push the repo.");
      break;
    case "unknown":
      say("warn", "Could not ask GitHub about this workflow (is gh signed in?).");
      break;
  }

  const differs = job.remoteCrons && job.state !== "not-on-github"
    && [...job.crons.map((c) => c.expr)].sort().join(" | ") !== [...job.remoteCrons].sort().join(" | ");
  if (differs) {
    say("warn", `Local schedule differs from GitHub's (GitHub runs: ${[...job.remoteCrons].sort().join(" | ") || "none"}) - commit and push to apply.`);
  }

  const last = job.lastScheduled;
  if (last?.conclusion && !["success", "skipped", "neutral"].includes(last.conclusion)) {
    say("error", `Last scheduled run ended "${last.conclusion}".`);
  }

  // A run that should have happened since the last one but did not. Only
  // judged when the job is enabled and GitHub's crons match ours.
  if (job.state === "active" && last?.createdAt && !differs) {
    const after = new Date(last.createdAt);
    const expected = job.crons
      .filter((c) => !c.error)
      .map((c) => nextRunsFn(c.expr, after, 1)[0])
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    if (expected && now - expected > MISSED_GRACE_MS) {
      say("warn", `Expected a scheduled run around ${expected.toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} - none recorded.`);
    }
  }

  const info = job.repoInfo;
  if (info && !info.private && !isFork && info.pushedAt && job.state === "active") {
    const idle = (now - new Date(info.pushedAt)) / DAY_MS;
    if (idle >= INACTIVITY_WARN_DAYS) {
      const at = new Date(new Date(info.pushedAt).getTime() + INACTIVITY_DAYS * DAY_MS);
      say("warn", `No pushes for ${Math.floor(idle)} days - GitHub auto-disables public-repo schedules around ${at.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}. Any commit resets the clock.`);
    }
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return w.sort((a, b) => rank[a.level] - rank[b.level]);
}
