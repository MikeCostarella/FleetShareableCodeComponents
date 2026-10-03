// Shapes shared by the scheduled-jobs server half (jobs.mjs) and this panel.
// Part of FleetShareableCodeComponents/scheduled-jobs - edit it THERE.

export interface ScheduleRun {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface ScheduledJob {
  id: string;
  repo: string;
  fullName: string;
  role: string | null;
  source: "disk" | "github";
  file: string;
  path: string;
  name: string;
  dispatchable: boolean;
  slug: string | null;
  repoUrl: string | null;
  actionsUrl: string | null;
  editUrl: string | null;
  pagesUrl: string | null;
  crons: { expr: string; comment: string; text: string; utc: string; next: string | null; error?: string }[];
  next: string | null;
  upcoming: string[];
  /** active | disabled_manually | disabled_inactivity | disabled_fork | not-on-github | no-remote | unknown */
  state: string;
  lastScheduled: ScheduleRun | null;
  lastRun: ScheduleRun | null;
  repoInfo: { pushedAt?: string; private?: boolean; fork?: boolean; defaultBranch?: string } | null;
  remoteCrons: string[] | null;
  warnings: { level: "error" | "warn" | "info"; text: string }[];
  /** What THIS viewer may do - decided by the app's server, not the panel. */
  can: { toggle: boolean; run: boolean; edit: boolean };
}

export interface SchedulesResponse {
  generated?: string;
  tz?: string;
  /** Free text for the header, e.g. "229 repos scanned" or "12 org repos". */
  scope?: string;
  cached?: boolean;
  jobs?: ScheduledJob[];
  errors?: { fullName: string; error: string }[];
  error?: string;
}

export interface ActionResult { ok?: boolean; error?: string; text?: string }

/** One line of Statehouse's data/job-runs/YYYY-MM.jsonl, plus the delay the server works out. */
export interface JobRun {
  id: number;
  fullName: string;
  repo: string;
  workflow: string;
  file: string;
  event: "schedule" | "workflow_dispatch" | string;
  conclusion: string | null;
  startedAt: string;
  durationS: number | null;
  attempt?: number;
  url: string;
  commit: { sha: string; message: string; url: string } | null;
  scheduledFor?: string;
  delayMin?: number;
}

export interface JobSummary {
  id: string;
  repo: string;
  fullName: string;
  workflow: string;
  file: string;
  runs: number;
  scheduled: number;
  manual: number;
  success: number;
  failure: number;
  other: number;
  commits: number;
  medianDelayMin: number | null;
  lastRun: JobRun | null;
  lastCommit: (JobRun["commit"] & { startedAt: string }) | null;
}

export interface HistoryResponse {
  generated?: string;
  months?: string[];
  /** Where the log was read from, for the header. */
  source?: string;
  runs?: JobRun[];
  summary?: JobSummary[];
  error?: string;
}
