import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, addYears, compare, daysInMonth, diffDays, fromDate, isIsoDate, isWeekend,
  nextBusinessDay, parseIsoDate, toDate, type IsoDate,
} from "./dates";

const d = (s: string) => s as IsoDate;

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
    expect(isIsoDate("2025-1-01")).toBe(false);
    expect(isIsoDate(20250101)).toBe(false);
    expect(() => parseIsoDate("nope")).toThrow(RangeError);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it("Feb 29 + N years clamps", () => {
    expect(addYears(d("2024-02-29"), 1)).toBe("2025-02-28");
    expect(addYears(d("2024-02-29"), 3)).toBe("2027-02-28");
    expect(addYears(d("2024-02-29"), 4)).toBe("2028-02-29");
    expect(addYears(d("2024-02-29"), -4)).toBe("2020-02-29");
  });
  it("month-end clamping", () => {
    expect(addMonths(d("2025-01-31"), 1)).toBe("2025-02-28");
    expect(addMonths(d("2024-01-31"), 1)).toBe("2024-02-29");
    expect(addMonths(d("2025-03-31"), -1)).toBe("2025-02-28");
    expect(addMonths(d("2025-11-30"), 3)).toBe("2026-02-28");
    expect(addMonths(d("2025-12-15"), 1)).toBe("2026-01-15");
    expect(addMonths(d("2025-01-15"), -1)).toBe("2024-12-15");
    expect(addMonths(d("2025-01-15"), 0)).toBe("2025-01-15");
  });
  it("addDays crosses month, year and leap boundaries", () => {
    expect(addDays(d("2025-12-31"), 1)).toBe("2026-01-01");
    expect(addDays(d("2024-02-28"), 1)).toBe("2024-02-29");
    expect(addDays(d("2025-02-28"), 1)).toBe("2025-03-01");
    expect(addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
    expect(addDays(d("0999-12-31"), 1)).toBe("1000-01-01");
  });
  it("diffDays/compare are symmetric and DST-safe", () => {
    expect(diffDays(d("2026-03-07"), d("2026-03-09"))).toBe(2); // US DST change
    expect(diffDays(d("2026-11-01"), d("2026-10-29"))).toBe(-3);
    expect(compare(d("2026-01-01"), d("2026-01-02"))).toBe(-1);
    expect(compare(d("2026-01-02"), d("2026-01-02"))).toBe(0);
    expect(compare(d("2026-01-03"), d("2026-01-02"))).toBe(1);
  });
  it("weekend and business day", () => {
    expect(isWeekend(d("2026-11-01"))).toBe(true); // Sunday
    expect(isWeekend(d("2026-10-31"))).toBe(true); // Saturday
    expect(isWeekend(d("2026-11-02"))).toBe(false);
    expect(nextBusinessDay(d("2026-10-31"))).toBe("2026-11-02");
    expect(nextBusinessDay(d("2026-11-02"))).toBe("2026-11-02");
    expect(nextBusinessDay(d("2026-11-02"), ["2026-11-02"])).toBe("2026-11-03");
    expect(nextBusinessDay(d("2026-10-30"), ["2026-10-30", "2026-10-31", "2026-11-02"])).toBe("2026-11-03");
  });
  it("Date conversion is UTC", () => {
    expect(fromDate(new Date("2026-11-01T23:59:59Z"))).toBe("2026-11-01");
    expect(toDate(d("2026-11-01")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
