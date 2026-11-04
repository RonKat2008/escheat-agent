import { describe, expect, it } from "vitest";
import { plural } from "./define";

describe("plural (chat tool summaries)", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "deadline")).toBe("1 deadline");
    expect(plural(1, "recovery", "recoveries")).toBe("1 recovery");
    expect(plural(1, "open item")).toBe("1 open item");
  });
  it("uses the plural for zero and many", () => {
    expect(plural(0, "deadline")).toBe("0 deadlines");
    expect(plural(2, "run")).toBe("2 runs");
    expect(plural(3, "recovery", "recoveries")).toBe("3 recoveries");
  });
});
