import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScheduledJobs, scanLocalDir } from "../src/jobs.mjs";

const WF = `name: Site health
on:
  schedule:
    - cron: "41 11 * * *"
  workflow_dispatch:
`;
const b64 = (s) => Buffer.from(s).toString("base64");

/** A fake gh that answers `gh api <path> --jq ...` from a route table (already-jq'd JSON). */
function fakeGh(routes, calls = []) {
  return async (args) => {
    calls.push(args);
    if (args[0] !== "api") return { ok: true, out: "", err: "" };
    const key = args[1];
    if (!(key in routes)) return { ok: false, out: "", err: "HTTP 404: Not Found" };
    return { ok: true, out: JSON.stringify(routes[key]), err: "" };
  };
}

const ORG = "MyWebSiteParticipants/Bullpen";
const ROUTES = {
  [`repos/${ORG}`]: { pushedAt: "2026-10-01T00:00:00Z", private: false, fork: false, defaultBranch: "main", parent: null },
  [`repos/${ORG}/actions/workflows?per_page=100`]: [
    { path: ".github/workflows/site-health.yml", name: "Site health", state: "active", url: "https://github.com/x" },
    { path: ".github/workflows/deploy.yml", name: "Deploy", state: "active", url: "https://github.com/y" },
    { path: "dynamic/pages/pages-build-deployment", name: "pages-build-deployment", state: "active", url: "z" },
  ],
  [`repos/${ORG}/contents/.github/workflows/site-health.yml`]: b64(WF),
  [`repos/${ORG}/contents/.github/workflows/deploy.yml`]: b64("name: Deploy\non:\n  push:\n"),
  [`repos/${ORG}/actions/workflows/site-health.yml/runs?per_page=1&event=schedule`]: { id: 1, status: "completed", conclusion: "success", event: "schedule", createdAt: "2026-10-02T12:00:00Z", updatedAt: "x", url: "u" },
  [`repos/${ORG}/actions/workflows/site-health.yml/runs?per_page=1`]: { id: 2, status: "completed", conclusion: "success", event: "workflow_dispatch", createdAt: "2026-10-02T13:00:00Z", updatedAt: "x", url: "u2" },
};
const NOW = new Date("2026-10-02T14:25:00Z");

describe("jobsFor (from GitHub)", () => {
  it("finds only scheduled workflows and fills runs, links and permissions", async () => {
    const sj = createScheduledJobs({ runGh: fakeGh(ROUTES) });
    const { jobs, errors } = await sj.jobsFor([{ fullName: ORG, label: "Bullpen", role: "upstream", can: { toggle: false, run: false } }], { now: NOW });
    expect(errors).toEqual([]);
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.id).toBe(`${ORG}/site-health.yml`);
    expect(j.repo).toBe("Bullpen");
    expect(j.source).toBe("github");
    expect(j.state).toBe("active");
    expect(j.crons[0].text).toBe("daily at 7:41 AM");
    expect(j.next).toBe("2026-10-03T11:41:00.000Z");
    expect(j.lastScheduled.id).toBe(1);
    expect(j.lastRun.id).toBe(2);
    expect(j.editUrl).toBe(`https://github.com/${ORG}/edit/main/.github/workflows/site-health.yml`);
    expect(j.can).toEqual({ toggle: false, run: false, edit: true });
    expect(j.remoteCrons).toBeNull();
    expect(j.warnings).toEqual([]);
  });

  it("a repo it cannot list is reported, not fatal", async () => {
    const sj = createScheduledJobs({ runGh: fakeGh(ROUTES) });
    const { jobs, errors } = await sj.jobsFor([{ fullName: "Nope/Missing", repoInfo: {} }, { fullName: ORG, can: { run: true } }], { now: NOW });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].can.run).toBe(true);
    expect(errors[0].fullName).toBe("Nope/Missing");
  });
});

describe("jobsFor (from a local checkout)", () => {
  it("reads crons from disk and compares with GitHub's copy", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sj-"));
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".github", "workflows", "site-health.yml"), WF.replace("41 11", "0 6"));
    fs.writeFileSync(path.join(dir, ".github", "workflows", "deploy.yml"), "name: Deploy\non:\n  push:\n");
    expect(scanLocalDir(dir).map((w) => w.file)).toEqual(["site-health.yml"]);

    const routes = { ...ROUTES, [`repos/${ORG}/actions/workflows/site-health.yml`]: { state: "active", url: "x" } };
    const sj = createScheduledJobs({ runGh: fakeGh(routes) });
    const { jobs } = await sj.jobsFor([{ fullName: ORG, localDir: dir, can: { toggle: true, run: true } }], { now: NOW });
    expect(jobs[0].source).toBe("disk");
    expect(jobs[0].crons[0].expr).toBe("0 6 * * *");
    expect(jobs[0].remoteCrons).toEqual(["41 11 * * *"]);
    expect(jobs[0].warnings.some((w) => /differs from GitHub/.test(w.text))).toBe(true);
  });

  it("a workflow GitHub has never seen is 'not-on-github'", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sj-"));
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".github", "workflows", "new.yml"), WF);
    const sj = createScheduledJobs({ runGh: fakeGh(ROUTES) });
    const { jobs } = await sj.jobsFor([{ fullName: ORG, localDir: dir }], { now: NOW });
    expect(jobs[0].state).toBe("not-on-github");
  });
});

describe("toggle / dispatch", () => {
  it("calls gh workflow with the repo", async () => {
    const calls = [];
    const sj = createScheduledJobs({ runGh: fakeGh({}, calls) });
    expect(await sj.toggle(ORG, "site-health.yml", false)).toEqual({ ok: true });
    expect(await sj.dispatch(ORG, "site-health.yml")).toEqual({ ok: true });
    expect(calls).toEqual([
      ["workflow", "disable", "site-health.yml", "--repo", ORG],
      ["workflow", "run", "site-health.yml", "--repo", ORG],
    ]);
  });
});
