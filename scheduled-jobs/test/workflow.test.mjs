import { describe, expect, it } from "vitest";
import { nextRuns } from "../src/cron.mjs";
import { assessJob, parseWorkflow } from "../src/workflow.mjs";

const HOUSING = `name: Refresh housing data
on:
  schedule:
    - cron: "0 12 8 * *" # 12:00 UTC on the 8th  — Realtor.com listings
    - cron: "0 12 21 * *" # 12:00 UTC on the 21st — Zillow home values
  workflow_dispatch:
`;

describe("parseWorkflow", () => {
  it("name, every cron with its comment, dispatchable", () => {
    const wf = parseWorkflow(HOUSING);
    expect(wf.name).toBe("Refresh housing data");
    expect(wf.crons.map((c) => c.expr)).toEqual(["0 12 8 * *", "0 12 21 * *"]);
    expect(wf.crons[0].comment).toMatch(/Realtor/);
    expect(wf.dispatchable).toBe(true);
  });
  it("single quotes, quoted name, no dispatch", () => {
    const wf = parseWorkflow(`name: 'Snapshot participants'\non:\n  push:\n  schedule:\n    - cron: '0 7 * * 1'       # weekly\n`);
    expect(wf.name).toBe("Snapshot participants");
    expect(wf.crons).toEqual([{ expr: "0 7 * * 1", comment: "weekly" }]);
    expect(wf.dispatchable).toBe(false);
  });
  it("a commented-out cron is not a schedule", () => {
    expect(parseWorkflow(`on:\n  schedule:\n    # - cron: "0 1 * * *"\n`).crons).toHaveLength(0);
  });
});

const NOW = new Date("2026-10-02T14:25:00Z");
const base = (over = {}) => ({
  state: "active",
  crons: [{ expr: "17 7 * * *" }],
  lastScheduled: { conclusion: "success", createdAt: "2026-10-02T07:40:00Z" },
  repoInfo: { private: false, fork: false, pushedAt: "2026-09-30T00:00:00Z" },
  remoteCrons: ["17 7 * * *"],
  ...over,
});
const assess = (job) => assessJob(job, nextRuns, { now: NOW });

describe("assessJob", () => {
  it("healthy job has no warnings", () => expect(assess(base())).toEqual([]));
  it("disabled for inactivity is an error", () => {
    const w = assess(base({ state: "disabled_inactivity" }));
    expect(w[0].level).toBe("error");
    expect(w[0].text).toMatch(/inactivity/);
  });
  it("a fork's default-off schedule is information, not alarm", () => {
    const w = assess(base({ state: "disabled_fork", repoInfo: { fork: true, private: false, pushedAt: "2026-01-01T00:00:00Z" } }));
    expect(w).toHaveLength(1);
    expect(w[0].level).toBe("info");
    expect(w[0].text).toMatch(/forks/);
  });
  it("failed last scheduled run, errors sorted first", () => {
    const w = assess(base({ state: "disabled_manually", lastScheduled: { conclusion: "failure", createdAt: "2026-10-02T07:40:00Z" } }));
    expect(w[0].level).toBe("error");
    expect(w[0].text).toMatch(/failure/);
  });
  it("hours late is not missed (GitHub routinely starts runs 5-7 h late)", () => {
    expect(assessJob(base({ lastScheduled: { conclusion: "success", createdAt: "2026-10-01T12:30:00Z" } }), nextRuns, { now: new Date("2026-10-02T18:00:00Z") }).some((x) => /Expected/.test(x.text))).toBe(false);
  });
  it("missed run", () => {
    expect(assess(base({ lastScheduled: { conclusion: "success", createdAt: "2026-09-29T07:40:00Z" } })).some((x) => /Expected a scheduled run/.test(x.text))).toBe(true);
  });
  it("local schedule not pushed suppresses the missed-run claim", () => {
    const w = assess(base({ crons: [{ expr: "0 12 8 * *" }, { expr: "0 12 21 * *" }], remoteCrons: ["0 12 21 * *"],
      lastScheduled: { conclusion: "success", createdAt: "2026-09-21T12:30:00Z" } }));
    expect(w.some((x) => /differs from GitHub/.test(x.text))).toBe(true);
    expect(w.some((x) => /Expected a scheduled run/.test(x.text))).toBe(false);
  });
  it("no local-vs-GitHub check when crons came from GitHub itself", () => {
    expect(assess(base({ remoteCrons: null }))).toEqual([]);
  });
  it("inactivity countdown for public, non-fork repos only", () => {
    const stale = { pushedAt: "2026-08-10T00:00:00Z" };
    expect(assess(base({ repoInfo: { ...stale, private: false } })).some((x) => /auto-disables/.test(x.text))).toBe(true);
    expect(assess(base({ repoInfo: { ...stale, private: true } })).some((x) => /auto-disables/.test(x.text))).toBe(false);
    expect(assess(base({ repoInfo: { ...stale, private: false, fork: true } })).some((x) => /auto-disables/.test(x.text))).toBe(false);
  });
});
