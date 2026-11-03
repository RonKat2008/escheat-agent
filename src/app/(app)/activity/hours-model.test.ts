import { describe, expect, it } from "vitest";
import { buildHourly } from "@/lib/queries/activity";
import { bucketKey, seismoHours } from "./density-model";

describe("hourly bucketing", () => {
  it("zero-fills exactly 24 UTC hours and ignores out-of-range rows", () => {
    const hours = buildHourly([
      { hour: 14, count: 20, attention: 2 },
      { hour: 9, count: 3, attention: 0 },
      { hour: 24, count: 99, attention: 0 },
      { hour: -1, count: 99, attention: 0 },
    ]);
    expect(hours).toHaveLength(24);
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(hours[14]).toEqual({ hour: 14, count: 20, attention: 2 });
    expect(hours.reduce((a, h) => a + h.count, 0)).toBe(23);
  });

  it("shares one scale between entries and approvals and caps approvals at the hour total", () => {
    const all = buildHourly([
      { hour: 9, count: 4, attention: 0 },
      { hour: 14, count: 16, attention: 0 },
    ]);
    const human = buildHourly([
      { hour: 9, count: 10, attention: 0 },
      { hour: 14, count: 4, attention: 0 },
    ]);
    const cells = seismoHours("2026-11-03", all, human, true);
    expect(cells).toHaveLength(24);
    expect(cells[9]!.human).toBe(4);
    expect(cells[14]!.up).toBe(100);
    expect(cells[14]!.down).toBe(50);
    expect(cells[0]!.up).toBe(0);
    expect(bucketKey(cells[9]!)).toBe("2026-11-03T09");
    expect(bucketKey({ day: "2026-11-03" })).toBe("2026-11-03");
  });
});
