import { describe, expect, it } from "vitest";
import {
  FOCUSABLE_SELECTOR,
  ariaSortFor,
  countMessage,
  nextMenuIndex,
  parseViewParam,
  trapTarget,
  withViewParam,
} from "../src/a11y";

describe("ariaSortFor", () => {
  it("is none for inactive columns", () => {
    expect(ariaSortFor("name", "city", true)).toBe("none");
    expect(ariaSortFor("name", null, true)).toBe("none");
  });
  it("reflects direction on the active column", () => {
    expect(ariaSortFor("name", "name", true)).toBe("ascending");
    expect(ariaSortFor("name", "name", false)).toBe("descending");
  });
});

describe("countMessage", () => {
  it("handles zero, one and many", () => {
    expect(countMessage(0, "provider")).toBe("No providers match");
    expect(countMessage(1, "provider")).toBe("1 provider");
    expect(countMessage(34, "provider")).toBe("34 providers");
  });
  it("groups thousands", () => {
    expect(countMessage(99728, "address point")).toBe("99,728 address points");
  });
  it("takes an irregular plural", () => {
    expect(countMessage(3, "landing zone", "landing zones")).toBe("3 landing zones");
    expect(countMessage(2, "facility", "facilities")).toBe("2 facilities");
  });
  it("adds the total only when filtered", () => {
    expect(countMessage(34, "provider", undefined, 120)).toBe("34 of 120 providers");
    expect(countMessage(120, "provider", undefined, 120)).toBe("120 providers");
    expect(countMessage(1, "provider", undefined, 1)).toBe("1 provider");
  });
});

describe("parseViewParam / withViewParam", () => {
  const views = ["map", "list"] as const;
  it("reads a known view", () => {
    expect(parseViewParam("?view=list", views, "map")).toBe("list");
    expect(parseViewParam("?x=1&view=LIST", views, "map")).toBe("list");
  });
  it("falls back on missing or unknown", () => {
    expect(parseViewParam("", views, "map")).toBe("map");
    expect(parseViewParam("?view=table", views, "map")).toBe("map");
  });
  it("writes only non-default views and keeps other params", () => {
    expect(withViewParam("", "list", "map")).toBe("?view=list");
    expect(withViewParam("?view=list", "map", "map")).toBe("");
    expect(withViewParam("?q=warren", "list", "map")).toBe("?q=warren&view=list");
  });
});

describe("nextMenuIndex", () => {
  it("wraps arrows", () => {
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(0, 3, "ArrowDown")).toBe(1);
  });
  it("starts at the ends when nothing is focused", () => {
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
  });
  it("jumps with Home/End and handles empty menus", () => {
    expect(nextMenuIndex(1, 5, "Home")).toBe(0);
    expect(nextMenuIndex(1, 5, "End")).toBe(4);
    expect(nextMenuIndex(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("trapTarget", () => {
  it("wraps Tab from the last item to the first", () => {
    expect(trapTarget(4, 5, false)).toBe(0);
  });
  it("wraps Shift+Tab from the first item to the last", () => {
    expect(trapTarget(0, 5, true)).toBe(4);
  });
  it("lets the browser move focus in the middle", () => {
    expect(trapTarget(2, 5, false)).toBeNull();
    expect(trapTarget(2, 5, true)).toBeNull();
  });
  it("brings focus that left the dialog back in", () => {
    expect(trapTarget(-1, 5, false)).toBe(0);
    expect(trapTarget(-1, 5, true)).toBe(4);
  });
  it("keeps focus on the container when nothing inside can take it", () => {
    expect(trapTarget(-1, 0, false)).toBe(-1);
  });
});

describe("FOCUSABLE_SELECTOR", () => {
  it("skips disabled controls and tabindex=-1", () => {
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });
});
