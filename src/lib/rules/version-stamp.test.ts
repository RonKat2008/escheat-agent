import { describe, expect, it } from "vitest";
import { approvedVersion, versionStampAt } from "./apply";

describe("versionStampAt (R6-12)", () => {
  it("puts a real-clock day that has not happened on the demo clock onto the demo date, keeping the time of day", () => {
    const at = versionStampAt("2026-11-04T04:21:13.123Z", "2026-11-01");
    expect(at).toBe("2026-11-01T04:21:13.123Z");
    expect(approvedVersion("2026.10.1-draft", at)).toBe("2026.10.1-draft+appr.20261101T042113");
  });
  it("stamps the demo date after the clock jumps past the real date (R7-04)", () => {
    const at = versionStampAt("2026-11-04T08:24:08.000Z", "2029-03-30");
    expect(approvedVersion("2026.10.1-draft", at)).toBe("2026.10.1-draft+appr.20290330T082408");
  });
  it("stamps the demo date when the clock is earlier than the real date", () => {
    expect(versionStampAt("2026-11-04T08:24:08.000Z", "2026-10-20")).toBe("2026-10-20T08:24:08.000Z");
  });
});
