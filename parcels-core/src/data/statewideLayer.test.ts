// Tests for the statewide-layer key helpers.
//
// The config module is mocked per test, because these behaviours are
// per-county settings and this file must pass unchanged in every repo the
// vendor tree is copied into - the county it happens to sit in must not
// decide which branches are reachable.
import { afterEach, describe, expect, it, vi } from "vitest";

type StatewideLayer = typeof import("./statewideLayer");

async function loadWith(setting: string): Promise<StatewideLayer> {
  vi.resetModules();
  vi.doMock("../../../config/county", () => ({
    COUNTY_NAME: "Testshire",
    STATE_PARCEL_KEY: setting,
  }));
  return await import("./statewideLayer");
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("stateParcelKey", () => {
  it("strips punctuation and uppercases (the Greene form)", async () => {
    const { stateParcelKey } = await loadWith("stripped");
    expect(stateParcelKey("E13-0001-0016-0-0017-00")).toBe("E13000100160001700");
  });

  it("returns an empty string for null and undefined", async () => {
    const { stateParcelKey } = await loadWith("stripped");
    expect(stateParcelKey(null)).toBe("");
    expect(stateParcelKey(undefined)).toBe("");
  });
});

describe("dashedStateKey", () => {
  // Pickaway parcel verified against the live service, 9 August 2026.
  it("regroups a stored undashed number into the service's dashed form", async () => {
    const { dashedStateKey } = await loadWith("dashed");
    expect(dashedStateKey("K2500030016400")).toBe("K25-0-003-00-164-00");
  });

  it("round-trips a number that is already dashed", async () => {
    const { dashedStateKey } = await loadWith("dashed");
    expect(dashedStateKey("K25-0-003-00-164-00")).toBe("K25-0-003-00-164-00");
  });

  it("uppercases on the way through", async () => {
    const { dashedStateKey } = await loadWith("dashed");
    expect(dashedStateKey("j2400030002602")).toBe("J24-0-003-00-026-02");
  });

  it("throws on a number that is not one letter plus 13 digits", async () => {
    const { dashedStateKey } = await loadWith("dashed");
    // Franklin-form number: digits with a dash, no leading letter.
    expect(() => dashedStateKey("232-000007")).toThrow(/dashed form/);
    // Junk row observed in the live layer.
    expect(() => dashedStateKey("cemetery")).toThrow(/dashed form/);
    expect(() => dashedStateKey("")).toThrow(/dashed form/);
  });
});

describe("stateQueryKey", () => {
  it('passes the number through trimmed for "as-stored"', async () => {
    const { stateQueryKey } = await loadWith("as-stored");
    expect(stateQueryKey(" 232-000007 ")).toBe("232-000007");
  });

  it('strips for "stripped"', async () => {
    const { stateQueryKey } = await loadWith("stripped");
    expect(stateQueryKey("009-09-017")).toBe("00909017");
  });

  it('regroups for "dashed"', async () => {
    const { stateQueryKey } = await loadWith("dashed");
    expect(stateQueryKey("K2500030016400")).toBe("K25-0-003-00-164-00");
  });

  it('throws loudly for "not-applicable"', async () => {
    const { stateQueryKey } = await loadWith("not-applicable");
    expect(() => stateQueryKey("K2500030016400")).toThrow(/not-applicable/);
  });
});
