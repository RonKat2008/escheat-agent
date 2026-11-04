import { describe, expect, it } from "vitest";
import { approvedVersion, versionStampAt } from "./apply";

describe("versionStampAt (R6-12)", () => {
  it("puts a real-clock day that has not happened on the demo clock onto the demo date, keeping the time of day", () => {
    const at = versionStampAt("2026-11-04T04:21:13.123Z", "2026-11-01");
    expect(at).toBe("2026-11-01T04:21:13.123Z");
    expect(approvedVersion("2026.10.1-draft", at)).toBe("2026.10.1-draft+appr.20261101T042113");
  });
  it("leaves a day already past on the demo clock alone", () => {
    expect(versionStampAt("2026-10-20T10:00:00.000Z", "2026-11-01")).toBe("2026-10-20T10:00:00.000Z");
  });
});
