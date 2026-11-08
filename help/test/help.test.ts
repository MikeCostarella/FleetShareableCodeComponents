import { describe, expect, it } from "vitest";
import { groupTopics, matches, normalize } from "../src/help";

describe("normalize", () => {
  it("lower-cases, strips accents and punctuation", () => {
    expect(normalize("  Café — D-5j / CED!  ")).toBe("cafe d 5j ced");
  });
});

describe("matches", () => {
  const text = "Roll-ups: permits per jurisdiction and voting precinct, with Site Vote counts";
  it("empty query matches everything", () => expect(matches("  ", text)).toBe(true));
  it("every word must appear as a word prefix", () => {
    expect(matches("precinct site", text)).toBe(true);
    expect(matches("juris vot", text)).toBe(true);
    expect(matches("precinct ward", text)).toBe(false);
  });
  it("does not match inside a word", () => expect(matches("isdiction", text)).toBe(false));
  it("ignores case and punctuation", () => expect(matches("ROLL UPS", text)).toBe(true));
});

describe("groupTopics", () => {
  it("keeps first-appearance order of groups and topics", () => {
    const t = (id: string, group?: string) => ({ id, title: id, group, body: null });
    const g = groupTopics([t("a", "Start"), t("b", "Views"), t("c", "Start"), t("d")]);
    expect(g.map((x) => [x.group, x.topics.map((y) => y.id)])).toEqual([
      ["Start", ["a", "c"]],
      ["Views", ["b"]],
      ["", ["d"]],
    ]);
  });
});
