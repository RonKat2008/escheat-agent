import { describe, expect, it } from "vitest";
import { monthShort } from "./pdf";

describe("monthShort", () => {
  it("uses a four-digit year so it never reads as a day of the month", () => {
    expect(monthShort("2026-11")).toBe("Nov 2026");
    expect(monthShort("2027-01")).toBe("Jan 2027");
  });
});
