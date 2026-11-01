import { describe, expect, it } from "vitest";
import { nodeState, numberSources, todayIndex } from "./timeline";

const src = (url: string, title = url, quote = "") => ({ url, title, quote });

describe("numberSources", () => {
  it("numbers sources in first-cited order and lists each URL once across the whole timeline", () => {
    const { list, refs } = numberSources([
      { key: "presumed_abandoned", sources: [src("https://a"), src("https://b")] },
      { key: "dd_window_start", sources: [src("https://b"), src("https://c")] },
      { key: "report_due", sources: [src("https://a")] },
    ]);
    expect(list.map((s) => [s.n, s.url])).toEqual([
      [1, "https://a"],
      [2, "https://b"],
      [3, "https://c"],
    ]);
    expect(refs.get("presumed_abandoned")).toEqual([1, 2]);
    expect(refs.get("dd_window_start")).toEqual([2, 3]);
    expect(refs.get("report_due")).toEqual([1]);
  });

  it("keeps the first title and quote when a URL is cited again", () => {
    const { list } = numberSources([
      { key: "x", sources: [src("https://a", "Statute 1", "first quote")] },
      { key: "y", sources: [src("https://a", "Other title", "second quote")] },
    ]);
    expect(list).toEqual([{ n: 1, url: "https://a", title: "Statute 1", quote: "first quote" }]);
  });

  it("collapses repeats within one node and ignores blank URLs", () => {
    const { list, refs } = numberSources([{ key: "x", sources: [src("https://b"), src(" https://b "), src("  "), src("https://a")] }]);
    expect(list.map((s) => s.url)).toEqual(["https://b", "https://a"]);
    expect(refs.get("x")).toEqual([1, 2]);
  });

  it("gives nodes without sources no entry, and an empty timeline an empty list", () => {
    expect(numberSources([{ key: "issued", sources: [] }]).refs.has("issued")).toBe(false);
    expect(numberSources([])).toEqual({ list: [], refs: new Map() });
  });

  it("sorts a node's references ascending even when it cites a later source first", () => {
    const { refs } = numberSources([
      { key: "a", sources: [src("https://1"), src("https://2")] },
      { key: "b", sources: [src("https://2"), src("https://1")] },
    ]);
    expect(refs.get("b")).toEqual([1, 2]);
  });
});

describe("todayIndex", () => {
  const nodes = [{ date: "2025-09-01" }, { date: "2026-03-01" }, { date: null }, { date: "2028-09-01" }, { date: "2028-10-31" }];
  it("sits before the first date on or after today, skipping undated nodes", () => {
    expect(todayIndex(nodes, "2026-11-01")).toBe(3);
  });
  it("sits before a date that falls on today", () => {
    expect(todayIndex(nodes, "2028-09-01")).toBe(3);
  });
  it("goes first when everything is in the future and last when everything is past", () => {
    expect(todayIndex(nodes, "2020-01-01")).toBe(0);
    expect(todayIndex(nodes, "2030-01-01")).toBe(nodes.length);
  });
  it("is null when no node has a date", () => {
    expect(todayIndex([{ date: null }], "2026-11-01")).toBeNull();
  });
});

describe("nodeState", () => {
  it("marks unknown, next, past and future", () => {
    expect(nodeState({ key: "a", date: null }, "a", "2026-11-01")).toBe("unknown");
    expect(nodeState({ key: "a", date: "2028-01-01" }, "a", "2026-11-01")).toBe("next");
    expect(nodeState({ key: "b", date: "2025-01-01" }, "a", "2026-11-01")).toBe("past");
    expect(nodeState({ key: "b", date: "2029-01-01" }, "a", "2026-11-01")).toBe("future");
  });
});
