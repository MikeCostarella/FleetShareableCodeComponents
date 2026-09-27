// Tests for resume + checkpointing (Statehouse #10).
// The contract: a checkpoint threshold is a COUNT, never an offset's
// divisibility — the modulo form stopped flushing after the first short page,
// and never flushed at all on a resumed run.

import { describe, expect, it, vi } from "vitest";
import { makeCheckpointer } from "./harvestIo.mjs";

describe("makeCheckpointer", () => {
  const spy = () => {
    const writes = [];
    return { writes, write: (path, text) => writes.push({ path, text }) };
  };

  it("flushes every N features consumed", () => {
    const { writes, write } = spy();
    const records = [];
    const cp = makeCheckpointer("/out.json", () => records, { everyFeatures: 100, write });
    for (let i = 0; i < 10; i++) cp.advance(30); // 300 features
    expect(writes).toHaveLength(3);
  });

  it("still flushes when pages come back short — the modulo form never did", () => {
    // Pages of 3000, then one short page of 2731, then 3000s again. With
    // `offset % (PAGE * 10) === 0` no further checkpoint is ever written.
    const { writes, write } = spy();
    const cp = makeCheckpointer("/out.json", () => [], { everyFeatures: 30_000, write });
    const pages = [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 2731, 3000, 3000, 3000];
    for (const n of pages) cp.advance(n);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(cp.flushes).toBeGreaterThanOrEqual(1);
  });

  it("flushes on a resumed run, where the offset is not a multiple of the page size", () => {
    const { writes, write } = spy();
    const cp = makeCheckpointer("/out.json", () => [], { everyFeatures: 10, write });
    cp.advance(7); // resumed mid-page
    expect(writes).toHaveLength(0);
    cp.advance(7);
    expect(writes).toHaveLength(1);
  });

  it("resets the counter after a flush, so it does not flush on every later page", () => {
    const { writes, write } = spy();
    const cp = makeCheckpointer("/out.json", () => [], { everyFeatures: 10, write });
    cp.advance(10);
    cp.advance(1);
    expect(writes).toHaveLength(1);
    expect(cp.pending).toBe(1);
  });

  it("flush() is unconditional and serialises whatever the getter returns now", () => {
    const { writes, write } = spy();
    const records = [{ a: 1 }];
    const cp = makeCheckpointer("/out.json", () => records, { everyFeatures: 1e9, write });
    records.push({ a: 2 });
    cp.flush();
    expect(JSON.parse(writes[0].text)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
