// Tests for the padded progress line (Statehouse #10).

import { describe, expect, it } from "vitest";
import { progress } from "./progress.mjs";

const sink = () => {
  const written = [];
  return { written, write: (s) => written.push(s) };
};

describe("progress", () => {
  it("counts up against a total", () => {
    const stream = sink();
    const p = progress({ label: "features ", total: 1000, stream });
    p.tick(250);
    p.tick(250);
    expect(p.count).toBe(500);
    expect(stream.written.at(-1)).toContain("features 500 / 1,000");
  });

  it("pads, so a shorter line does not leave the tail of a longer one on screen", () => {
    const stream = sink();
    const p = progress({ total: 1_000_000, stream, width: 40 });
    p.set(1_000_000);
    const long = stream.written.at(-1);
    p.note("swept 12 ...");
    const short = stream.written.at(-1);
    expect(long.length).toBe(short.length);
    expect(short).toMatch(/swept 12 \.\.\. +$/);
  });

  it("works without a total", () => {
    const stream = sink();
    const p = progress({ label: "fetched ", stream });
    p.tick(42);
    expect(stream.written.at(-1)).toContain("fetched 42");
    expect(stream.written.at(-1)).not.toContain("/");
  });

  it("done() ends the line", () => {
    const stream = sink();
    progress({ stream }).done();
    expect(stream.written.at(-1)).toBe("\n");
  });
});
