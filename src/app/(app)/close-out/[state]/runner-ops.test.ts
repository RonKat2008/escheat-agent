import { describe, expect, it } from "vitest";
import { composeMessage } from "./runner-ops";

describe("composeMessage (R6-15)", () => {
  it("counts letters composed earlier as ready too, so it agrees with the step below", () => {
    expect(composeMessage({ composed: 1, ready: 0, blocked: 1, failed: 0 }, 1)).toBe(
      "Composed 1 letter: 1 ready to read and approve, 1 needs fixing in Approvals. Nothing was sent.",
    );
  });

  it("adds this click's ready letters to the earlier ones", () => {
    expect(composeMessage({ composed: 3, ready: 2, blocked: 0, failed: 1 }, 4)).toBe("Composed 3 letters: 6 ready to read and approve, 1 failed. Nothing was sent.");
  });
});
