import { describe, expect, it } from "vitest";
import { groupParseErrors, MAX_EXAMPLE_LINES } from "./errors";
import type { ParseError } from "./csv";

const err = (row: number, message: string, field?: string): ParseError => ({ row, message, ...(field ? { field } : {}), raw: null });

describe("groupParseErrors", () => {
  it("collapses identical errors into one group with a count and capped example lines", () => {
    const errors = Array.from({ length: 648 }, (_, i) => err(i + 2, "unknown kind 'vendor_check'", "kind"));
    const groups = groupParseErrors(errors);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 648, field: "kind", message: "unknown kind 'vendor_check'" });
    expect(groups[0]!.lines).toEqual([2, 3, 4, 5, 6].slice(0, MAX_EXAMPLE_LINES));
  });

  it("keeps different messages and fields apart, biggest group first", () => {
    const groups = groupParseErrors([err(2, "a", "x"), err(3, "b", "x"), err(4, "b", "x"), err(5, "a", "y")]);
    expect(groups.map((g) => [g.field, g.message, g.count])).toEqual([
      ["x", "b", 2],
      ["x", "a", 1],
      ["y", "a", 1],
    ]);
  });

  it("returns nothing for no errors", () => expect(groupParseErrors([])).toEqual([]));
});
