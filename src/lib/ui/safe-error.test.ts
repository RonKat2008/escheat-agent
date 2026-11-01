import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./safe-error";

describe("safeErrorMessage", () => {
  it("never echoes the error message, only the fallback and digest", () => {
    const err = Object.assign(new Error('Failed query: select * from "stale_items" where company_id = $1 params: 0fb06b79'), { digest: "1234567" });
    const text = safeErrorMessage(err, "Items could not load.");
    expect(text).toBe("Items could not load. Reference 1234567.");
    expect(text).not.toMatch(/select|params|stale_items/i);
  });
  it("omits the reference when there is no digest", () => {
    expect(safeErrorMessage(new Error("boom"), "Try again.")).toBe("Try again.");
  });
});
