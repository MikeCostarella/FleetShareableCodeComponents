import { describe, expect, it } from "vitest";
import { buildHistory, parseRunLog, recentMonths, summarizeRuns, withDelay } from "../src/history.mjs";

const E = (o) => ({ id: 1, fullName: "MyWebSiteParticipants/Bullpen", repo: "Bullpen", workflow: "CI", file: "ci.yml",
  event: "schedule", conclusion: "success", startedAt: "2026-10-03T12:30:10Z", durationS: 25, url: "u", commit: null, ...o });

describe("parseRunLog / recentMonths", () => {
  it("skips blank and torn lines", () => {
    expect(parseRunLog('{"id":1}\n\n{"id":2\n{"id":3}\n').map((e) => e.id)).toEqual([1, 3]);
  });
  it("months newest first, across a year boundary", () => {
    expect(recentMonths(3, new Date("2027-01-15T00:00:00Z"))).toEqual(["2027-01", "2026-12", "2026-11"]);
  });
});

describe("withDelay", () => {
  it("measures a scheduled run against the cron time it was meant for", () => {
    const [e] = withDelay([E({})], new Map([["MyWebSiteParticipants/Bullpen/ci.yml", ["17 7 * * *"]]]));
    expect(e.scheduledFor).toBe("2026-10-03T07:17:00.000Z");
    expect(e.delayMin).toBe(313);
  });
  it("leaves manual runs and unknown jobs alone", () => {
    const crons = new Map([["MyWebSiteParticipants/Bullpen/ci.yml", ["17 7 * * *"]]]);
    expect(withDelay([E({ event: "workflow_dispatch" })], crons)[0].delayMin).toBeUndefined();
    expect(withDelay([E({ file: "other.yml" })], crons)[0].delayMin).toBeUndefined();
  });
  it("a run that crosses midnight UTC still finds yesterday's slot", () => {
    const [e] = withDelay([E({ startedAt: "2026-10-04T02:00:00Z" })], new Map([["MyWebSiteParticipants/Bullpen/ci.yml", ["0 22 * * *"]]]));
    expect(e.delayMin).toBe(240);
  });
});

describe("summarizeRuns", () => {
  it("totals per job, typical delay, last commit", () => {
    const runs = [
      E({ id: 1, delayMin: 300 }),
      E({ id: 2, conclusion: "failure", delayMin: 360, startedAt: "2026-10-04T13:00:00Z" }),
      E({ id: 3, event: "workflow_dispatch", startedAt: "2026-10-04T14:00:00Z" }),
      E({ id: 4, file: "hq-data.yml", workflow: "Refresh HQ data", commit: { sha: "abc1234", message: "chore: x", url: "c" } }),
    ];
    const [ci, hq] = summarizeRuns(runs);
    expect(ci).toMatchObject({ workflow: "CI", runs: 3, scheduled: 2, manual: 1, success: 2, failure: 1, commits: 0, medianDelayMin: 330 });
    expect(ci.lastRun.id).toBe(3);
    expect(hq).toMatchObject({ runs: 1, commits: 1, medianDelayMin: null });
    expect(hq.lastCommit.sha).toBe("abc1234");
  });
});

describe("buildHistory", () => {
  it("reads the recent months, filters, adds delays and a summary", async () => {
    const files = {
      "2026-10": [JSON.stringify(E({ id: 1 })), JSON.stringify(E({ id: 2, fullName: "MikeCostarella/OhioCounties", repo: "OhioCounties" }))].join("\n"),
    };
    const h = await buildHistory({
      readMonth: async (m) => files[m] ?? null,
      months: 2,
      crons: new Map([["MyWebSiteParticipants/Bullpen/ci.yml", ["17 7 * * *"]]]),
      keep: (e) => e.fullName.startsWith("MyWebSiteParticipants/"),
      source: "test",
      now: new Date("2026-10-05T00:00:00Z"),
    });
    expect(h.months).toEqual(["2026-10", "2026-09"]);
    expect(h.runs.map((r) => r.id)).toEqual([1]);
    expect(h.runs[0].delayMin).toBe(313);
    expect(h.summary[0].runs).toBe(1);
  });
});
