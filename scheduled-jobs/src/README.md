# scheduled-jobs

Every scheduled GitHub Actions job (`on: schedule`) across a set of repos:
when it runs in Eastern time, when it runs next, how its last scheduled run
went, and what needs attention. Controls are enable / disable / run now,
offered per job only where the host app says the viewer may use them.

| Half | Source | Vendored to | Used by |
|---|---|---|---|
| server | `scheduled-jobs/src/` | `<app>/server/vendor/scheduled-jobs/` | StatehouseUI, CSCI5802Fall2026Management, CSCI5802Fall2026Student |
| UI | `scheduled-jobs/ui/` | `<app>/react-app/src/vendor/scheduled-jobs/` | the same three |

Both are opt-in by folder: Statehouse's `sync-shared-code.py --lib scheduled-jobs`
(and `--lib scheduled-jobs-ui`) sweeps every manifest repo that already has the
vendor folder.

## Server half

```js
import { createScheduledJobs } from "./vendor/scheduled-jobs/index.mjs";
const sj = createScheduledJobs({ runGh }); // runGh(args) -> { ok, out, err }
const { jobs, errors } = await sj.jobsFor([
  { fullName: "MyWebSiteParticipants/Bullpen", label: "Bullpen", can: { toggle: true, run: true } },
]);
await sj.toggle(fullName, "site-health.yml", false);
await sj.dispatch(fullName, "site-health.yml");
```

A target with `localDir` reads its crons from that checkout and also fetches
GitHub's copy, so an edit that was never pushed is flagged (StatehouseUI). Without
`localDir` everything comes from GitHub (the course apps). The schedule itself is
never edited here: the pencil opens the workflow file, and the change goes through
a normal commit.

Warnings (`workflow.mjs` `assessJob`): unparseable cron, disabled (manually / for
inactivity), off-in-a-fork (info), not pushed, local cron differs from GitHub's,
failed last scheduled run, an expected run that never came (3 h grace), and the
public-repo 60-day inactivity countdown from day 45.

## UI half

```tsx
import ScheduledJobsDialog from "./vendor/scheduled-jobs/ScheduledJobsDialog";
<ScheduledJobsDialog
  views={[{ id: "org", label: "Org", load: (fresh) => fetch(`/api/schedules?fresh=${+fresh}`).then((r) => r.json()) }]}
  onToggle={(job, enabled) => ...} onRun={(job) => ...} onClose={...} />
```

Several `views` give tabs (the Student app: Class + My forks).

## Tests

`npm test` from the repo root (vitest): `scheduled-jobs/test/` covers cron parsing,
next runs, plain-words text, workflow parsing, every warning, and `jobsFor` against a
fake `gh` for both the GitHub-only and local-checkout paths.
