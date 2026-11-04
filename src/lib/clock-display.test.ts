import { describe, expect, it } from "vitest";
import { onDemoCalendar } from "./clock-display";

describe("onDemoCalendar", () => {
  it("clamps a real date ahead of the demo date to the demo date", () => {
    expect(onDemoCalendar("2026-11-04T00:53:11.000Z", "2026-11-01")).toBe("2026-11-01");
  });
  it("keeps a date on or before the demo date", () => {
    expect(onDemoCalendar("2026-10-20", "2026-11-01")).toBe("2026-10-20");
    expect(onDemoCalendar("2026-11-01T10:00:00Z", "2026-11-01")).toBe("2026-11-01");
  });
  it("returns null for missing input", () => {
    expect(onDemoCalendar(null, "2026-11-01")).toBeNull();
  });
});
