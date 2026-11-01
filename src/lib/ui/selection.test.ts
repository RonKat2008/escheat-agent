import { describe, expect, it } from "vitest";
import { rangeIds, withIds } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("rangeIds", () => {
  it("returns the inclusive range in either direction", () => {
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "d", "b")).toEqual(["b", "c", "d"]);
  });
  it("falls back to the target without an anchor, and ignores unknown targets", () => {
    expect(rangeIds(order, null, "c")).toEqual(["c"]);
    expect(rangeIds(order, "zz", "c")).toEqual(["c"]);
    expect(rangeIds(order, "a", "nope")).toEqual([]);
  });
});

describe("withIds", () => {
  it("adds and removes without mutating the input", () => {
    const base = new Set(["a"]);
    expect([...withIds(base, ["b", "c"], true)]).toEqual(["a", "b", "c"]);
    expect([...withIds(base, ["a"], false)]).toEqual([]);
    expect([...base]).toEqual(["a"]);
  });
});
