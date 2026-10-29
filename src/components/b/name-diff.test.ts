import { describe, expect, it } from "vitest";
import { nameDiff } from "./name-diff";

describe("nameDiff", () => {
  it("marks only the characters that differ from the reference", () => {
    const parts = nameDiff("Northwind Fixtures, Inc.", "Northwind Fixtures Inc");
    expect(parts.map((p) => p.text).join("")).toBe("Northwind Fixtures Inc");
    expect(parts.every((p) => !p.differs)).toBe(true); // variant is a subsequence of the reference
  });

  it("flags inserted characters", () => {
    const parts = nameDiff("Northwind Fixtures, Inc.", "Northwind Fixtures LLC");
    expect(parts.filter((p) => p.differs).map((p) => p.text).join("")).toMatch(/LC|L/);
  });

  it("is case-insensitive and handles empty input", () => {
    expect(nameDiff("ABC", "abc").every((p) => !p.differs)).toBe(true);
    expect(nameDiff("", "")).toEqual([]);
  });
});
