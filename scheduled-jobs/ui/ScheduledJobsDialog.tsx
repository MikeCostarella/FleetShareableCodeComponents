// The scheduled-jobs panel: every scheduled GitHub Actions job a view covers,
// when it runs (Eastern), when it runs next, how the last scheduled run went,
// and what needs attention. Controls appear per job only where the app's
// server says this viewer may use them (job.can).
//
// One component for StatehouseUI (fleet), the CSCI 5802 Management app (the
// participants org) and the Student app (class upstream + your forks): each
// passes one or more `views`, and the actions. Self-contained styling
// (scheduled-jobs.css, sj- classes) so it looks the same in every app; it
// picks up the app's --accent / --line / --muted / --panel if defined.
//
// Part of FleetShareableCodeComponents/scheduled-jobs - edit it THERE.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionResult, HistoryResponse, JobRun, ScheduledJob, SchedulesResponse } from "./types";
import "./scheduled-jobs.css";

export interface ScheduledJobsView {
  id: string;
  label: string;
  /** Shown above the table - who this view is for, what it can do. */
  note?: ReactNode;
  /** A jobs view... */
  load?: (fresh: boolean) => Promise<SchedulesResponse>;
  /** ...or a History view over Statehouse's run log. */
  history?: (fresh: boolean) => Promise<HistoryResponse>;
  emptyText?: ReactNode;
}

interface Props {
  title?: string;
  views: ScheduledJobsView[];
  initialView?: string;
  onToggle: (job: ScheduledJob, enabled: boolean) => Promise<ActionResult>;
  onRun: (job: ScheduledJob) => Promise<ActionResult>;
  /** Optional local edit (StatehouseUI opens VS Code). Without it, the pencil opens job.editUrl on GitHub. */
  onEdit?: (job: ScheduledJob) => Promise<ActionResult>;
  footer?: ReactNode;
  onClose: () => void;
}

const TZ = "America/New_York";

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "in 6 h", "in 3 d", "2 d ago" */
function rel(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const unit = abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))} min`
    : abs < 2 * 86_400_000 ? `${Math.round(abs / 3_600_000)} h`
    : `${Math.round(abs / 86_400_000)} d`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}

const STATES: Record<string, [string, string]> = {
  active: ["on", "enabled"],
  disabled_manually: ["off", "disabled"],
  disabled_inactivity: ["off", "disabled: inactivity"],
  disabled_fork: ["muted", "off in fork"],
  "not-on-github": ["warn", "not pushed"],
  "no-remote": ["warn", "no remote"],
  unknown: ["warn", "unknown"],
};

function StateChip({ state }: { state: string }) {
  const [cls, label] = STATES[state] ?? ["warn", state];
  return <span className={`sj-chip ${cls}`}>{label}</span>;
}

function RunCell({ run, now }: { run: ScheduledJob["lastScheduled"]; now: number }) {
  if (!run) return <span className="sj-muted">none yet</span>;
  const result = run.conclusion ?? run.status;
  const cls = run.conclusion === "success" ? "ok" : run.conclusion ? "bad" : "busy";
  return (
    <span>
      <a className={`sj-result ${cls}`} href={run.url} target="_blank" rel="noreferrer">{result}</a>
      <span className="sj-muted"> {"·"} {rel(run.createdAt, now)}</span>
    </span>
  );
}

export default function ScheduledJobsDialog({ title = "Scheduled jobs", views, initialView, onToggle, onRun, onEdit, footer, onClose }: Props) {
  const [viewId, setViewId] = useState(initialView ?? views[0]?.id);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const [data, setData] = useState<Record<string, SchedulesResponse>>({});
  const [hist, setHist] = useState<Record<string, HistoryResponse>>({});
  const [busy, setBusy] = useState<string | null>(null); // job id being acted on, or "load"
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (fresh: boolean) => {
    if (!view) return;
    setBusy("load");
    try {
      if (view.history) {
        const r = await view.history(fresh);
        setHist((h) => ({ ...h, [view.id]: r }));
      } else if (view.load) {
        const r = await view.load(fresh);
        setData((d) => ({ ...d, [view.id]: r }));
      }
    } catch (e) {
      if (view.history) setHist((h) => ({ ...h, [view.id]: { error: String(e) } }));
      else setData((d) => ({ ...d, [view.id]: { error: String(e) } }));
    } finally { setBusy(null); setNow(Date.now()); }
  }, [view]);

  const loaded = view ? (view.history ? !!hist[view.id] : !!data[view.id]) : true;
  useEffect(() => { if (view && !loaded) load(false); }, [view, loaded, load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = view && !view.history ? data[view.id] : undefined;
  const history = view?.history ? hist[view.id] : undefined;
  const checked = current?.generated || history?.generated;
  const jobs = current?.jobs ?? [];
  const attention = jobs.filter((j) => j.warnings.some((w) => w.level !== "info")).length;
  const repoCount = new Set(jobs.map((j) => j.fullName)).size;

  const upcoming = useMemo(() => {
    const horizon = now + 14 * 86_400_000;
    return jobs
      .filter((j) => !j.state.startsWith("disabled"))
      .flatMap((j) => j.upcoming.map((at) => ({ at, job: j })))
      .filter((u) => new Date(u.at).getTime() <= horizon)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, 12);
  }, [jobs, now]);

  const act = useCallback(async (job: ScheduledJob, what: "enable" | "disable" | "run") => {
    if (what === "disable" && !window.confirm(`Disable "${job.name}" in ${job.fullName}? Scheduled runs stop until it is enabled again.`)) return;
    setBusy(job.id); setNote(null);
    try {
      const r = what === "run" ? await onRun(job) : await onToggle(job, what === "enable");
      if (r.error) setNote({ ok: false, text: `${job.repo}: ${r.error}` });
      else setNote({ ok: true, text: r.text ?? (what === "run"
        ? `${job.repo}: run requested - it appears on the Actions page in a few seconds.`
        : `${job.repo}: ${job.name} ${what}d.`) });
      await load(true);
    } finally { setBusy(null); }
  }, [load, onRun, onToggle]);

  const edit = useCallback(async (job: ScheduledJob) => {
    if (onEdit) {
      const r = await onEdit(job);
      setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.text ?? `Opened ${job.repo}/${job.path}.` });
    } else if (job.editUrl) {
      window.open(job.editUrl, "_blank", "noopener");
    }
  }, [onEdit]);

  return (
    <div className="sj-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sj-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sj-head">
          <b>{title}</b>
          {current?.jobs && (
            <span className="sj-sub">
              {jobs.length} job{jobs.length === 1 ? "" : "s"} in {repoCount} repo{repoCount === 1 ? "" : "s"}
              {current.scope && <> {"·"} {current.scope}</>}
              {attention > 0 && <> {"·"} <span className="sj-attn">{attention} need attention</span></>}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {checked && <span className="sj-muted sj-small">checked {new Date(checked).toLocaleTimeString()}</span>}
          <button className="sj-btn" onClick={() => load(true)} title="Ask GitHub again" disabled={busy !== null}>
            {busy === "load" ? "…" : "↻"}
          </button>
          <button className="sj-close" onClick={onClose} aria-label="Close">{"✕"}</button>
        </div>

        {views.length > 1 && (
          <div className="sj-tabs" role="tablist">
            {views.map((v) => (
              <button key={v.id} role="tab" aria-selected={v.id === view?.id}
                className={`sj-tab ${v.id === view?.id ? "active" : ""}`}
                onClick={() => { setViewId(v.id); setNote(null); }}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        {view?.note && <div className="sj-viewnote">{view.note}</div>}

        {view?.history && <HistoryPanel data={history} now={now} />}
        {!view?.history && !current && <div className="sj-note">Asking GitHub{"…"}</div>}
        {current?.error && <div className="sj-note sj-bad">{current.error}</div>}
        {current?.errors?.map((e) => (
          <div key={e.fullName} className="sj-note sj-warn">{"⚠"} {e.fullName}: {e.error}</div>
        ))}
        {current?.jobs && jobs.length === 0 && (
          <div className="sj-note">{view?.emptyText ?? <>No workflow here has an <code>on: schedule</code> trigger.</>}</div>
        )}

        {jobs.length > 0 && (
          <div className="sj-scroll">
            <table className="sj-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Schedule (Eastern)</th>
                  <th>Next run</th>
                  <th>Last scheduled run</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => <JobRows key={j.id} job={j} now={now} busy={busy} onAct={act} onEdit={edit} />)}
              </tbody>
            </table>

            {upcoming.length > 0 && (
              <div className="sj-upcoming">
                <div className="sj-upcoming-title">Next 14 days</div>
                {upcoming.map((u) => (
                  <div key={`${u.job.id}@${u.at}`} className="sj-up-row">
                    <span>{fmtWhen(u.at)}</span>
                    <span className="sj-muted">{rel(u.at, now)}</span>
                    <span><b>{u.job.repo}</b> {"·"} {u.job.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {note && <div className={`sj-note ${note.ok ? "sj-good" : "sj-bad"}`}>{note.text}</div>}
        <div className="sj-foot">
          {footer ?? <>GitHub cron is UTC; times here are Eastern and move an hour with DST. Scheduled runs often start
            late - hours late is common - and busy periods can drop one. A schedule is changed by editing the workflow file
            ({"✎"}) and committing - this panel only enables, disables and dispatches. Public repos with no commit
            for 60 days get their schedules switched off by GitHub; forks start with them off.</>}
        </div>
      </div>
    </div>
  );
}

function JobRows({ job, now, busy, onAct, onEdit }: {
  job: ScheduledJob;
  now: number;
  busy: string | null;
  onAct: (j: ScheduledJob, what: "enable" | "disable" | "run") => void;
  onEdit: (j: ScheduledJob) => void;
}) {
  const enabled = job.state === "active";
  const paused = job.state.startsWith("disabled");
  const onGitHub = enabled || paused;
  const dis = busy !== null;
  const worst = job.warnings.some((w) => w.level === "error") ? "bad" : job.warnings.some((w) => w.level === "warn") ? "warn" : "";
  return (
    <>
      <tr className={`sj-row ${worst}`}>
        <td>
          <div className="sj-repo">{job.repoUrl ? <a href={job.repoUrl} target="_blank" rel="noreferrer">{job.repo}</a> : job.repo}</div>
          <div className="sj-muted sj-small">
            {job.actionsUrl ? <a href={job.actionsUrl} target="_blank" rel="noreferrer">{job.name}</a> : job.name}
            {" · "}<code>{job.file}</code>
          </div>
        </td>
        <td>
          {job.crons.map((c) => (
            <div key={c.expr} className="sj-cron" title={c.comment || undefined}>
              <div>{c.error ? <span className="sj-bad">{c.error}</span> : c.text}</div>
              <div className="sj-muted sj-small"><code>{c.expr}</code> {"·"} {c.utc}</div>
            </div>
          ))}
        </td>
        <td>
          {!paused && job.next ? (
            <>
              <div>{fmtWhen(job.next)}</div>
              <div className="sj-muted sj-small">{rel(job.next, now)}</div>
            </>
          ) : <span className="sj-muted">{paused ? "paused" : "-"}</span>}
        </td>
        <td>
          <RunCell run={job.lastScheduled} now={now} />
          {job.lastRun && job.lastRun.id !== job.lastScheduled?.id && (
            <div className="sj-muted sj-small">
              latest: <a href={job.lastRun.url} target="_blank" rel="noreferrer">{job.lastRun.conclusion ?? job.lastRun.status}</a> ({job.lastRun.event}, {rel(job.lastRun.createdAt, now)})
            </div>
          )}
        </td>
        <td><StateChip state={job.state} /></td>
        <td className="sj-actions">
          <div className="sj-btns">
            {onGitHub && job.can?.toggle && (
              <button className="sj-btn" disabled={dis} onClick={() => onAct(job, enabled ? "disable" : "enable")}>
                {busy === job.id ? "…" : enabled ? "Disable" : "Enable"}
              </button>
            )}
            {onGitHub && job.can?.run && (
              <button className="sj-btn" disabled={dis || !enabled} onClick={() => onAct(job, "run")}
                title={!enabled ? "Disabled workflows cannot be dispatched" : "Run it now (workflow_dispatch)"}>
                Run now
              </button>
            )}
            {job.can?.edit && (
              <button className="sj-btn" onClick={() => onEdit(job)} title="Edit the schedule (the workflow file)">{"✎"}</button>
            )}
          </div>
        </td>
      </tr>
      {job.warnings.map((w, i) => (
        <tr key={i} className="sj-warn-row">
          <td colSpan={6} className={w.level === "error" ? "sj-bad" : w.level === "warn" ? "sj-warn" : "sj-info"}>
            {w.level === "error" ? "⛔" : w.level === "warn" ? "⚠" : "ℹ"} {w.text}
          </td>
        </tr>
      ))}
    </>
  );
}

function fmtDur(s: number | null | undefined): string {
  if (s == null) return "";
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
}
function fmtDelay(m: number | null | undefined): string {
  if (m == null) return "-";
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
}

function HistoryPanel({ data, now }: { data: HistoryResponse | undefined; now: number }) {
  const [jobId, setJobId] = useState("all");
  if (!data) return <div className="sj-note">Reading the run log…</div>;
  if (data.error) return <div className="sj-note sj-bad">{data.error}</div>;
  const summary = data.summary ?? [];
  const all = data.runs ?? [];
  const runs = all.filter((r) => jobId === "all" || `${r.fullName}/${r.file}` === jobId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 80);
  if (all.length === 0) {
    return <div className="sj-note">No runs logged yet{data.months?.length ? ` for ${data.months.join(", ")}` : ""}. Statehouse's nightly run-log job fills this in.</div>;
  }
  return (
    <div className="sj-scroll">
      <div className="sj-muted sj-small">
        {all.length} run{all.length === 1 ? "" : "s"}{data.months?.length ? ` in ${[...data.months].reverse().join(", ")}` : ""}
        {data.source ? ` · ${data.source}` : ""} · click a job to filter the runs below
      </div>
      <table className="sj-table">
        <thead>
          <tr><th>Job</th><th>Runs</th><th>Results</th><th>Data commits</th><th>Typical start delay</th><th>Last run</th></tr>
        </thead>
        <tbody>
          {summary.map((j) => (
            <tr key={j.id} className={`sj-row ${j.failure ? "warn" : ""} sj-click ${jobId === j.id ? "sj-picked" : ""}`}
              onClick={() => setJobId(jobId === j.id ? "all" : j.id)} title="Show this job's runs below">
              <td>
                <div className="sj-repo">{j.repo}</div>
                <div className="sj-muted sj-small">{j.workflow} · <code>{j.file}</code></div>
              </td>
              <td data-label="Runs">{j.runs}<div className="sj-muted sj-small">{j.scheduled} scheduled{j.manual ? `, ${j.manual} manual` : ""}</div></td>
              <td data-label="Results">
                <span className="sj-result ok">{j.success} ✓</span>
                {j.failure > 0 && <span className="sj-result bad"> · {j.failure} ✗</span>}
                {j.other > 0 && <span className="sj-muted"> · {j.other} other</span>}
              </td>
              <td data-label="Data commits">
                {j.commits}
                {j.lastCommit && <div className="sj-muted sj-small"><a href={j.lastCommit.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>last {rel(j.lastCommit.startedAt, now)}</a></div>}
              </td>
              <td data-label="Typical delay">{fmtDelay(j.medianDelayMin)}</td>
              <td data-label="Last run">{j.lastRun && <RunCell run={{ id: j.lastRun.id, status: "completed", conclusion: j.lastRun.conclusion, event: j.lastRun.event, createdAt: j.lastRun.startedAt, updatedAt: j.lastRun.startedAt, url: j.lastRun.url }} now={now} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sj-upcoming">
        <div className="sj-hist-head">
          <span className="sj-upcoming-title">Runs, newest first</span>
          <select className="sj-select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="all">All jobs</option>
            {summary.map((j) => <option key={j.id} value={j.id}>{j.repo} · {j.workflow}</option>)}
          </select>
        </div>
        <table className="sj-table sj-runs">
          <thead><tr><th>Started (Eastern)</th><th>Job</th><th>Trigger</th><th>Result</th><th>Late by</th><th>Took</th><th>Data</th></tr></thead>
          <tbody>
            {runs.map((r: JobRun) => (
              <tr key={`${r.id}-${r.attempt ?? 1}`}>
                <td>{fmtWhen(r.startedAt)}</td>
                <td>{r.repo} · <span className="sj-muted">{r.workflow}</span></td>
                <td>{r.event === "schedule" ? "schedule" : "manual"}</td>
                <td><a className={`sj-result ${r.conclusion === "success" ? "ok" : r.conclusion ? "bad" : "busy"}`} href={r.url} target="_blank" rel="noreferrer">{r.conclusion ?? "?"}</a></td>
                <td data-label="Late by">{r.event === "schedule" ? fmtDelay(r.delayMin) : ""}</td>
                <td data-label="Took">{fmtDur(r.durationS)}</td>
                <td>{r.commit ? <a href={r.commit.url} target="_blank" rel="noreferrer" title={r.commit.message}>{r.commit.sha}</a> : <span className="sj-muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
