import { describe, expect, it } from "vitest";
import { assertCents, centsToDollars, dollarsToCents, formatAmount, formatUSD, mulRateCents, parseDollars, sumCents } from "./money";

describe("money", () => {
  it("formats", () => {
    expect(formatUSD(234000)).toBe("$2,340.00");
    expect(formatUSD(5)).toBe("$0.05");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(-1200)).toBe("-$12.00");
    expect(formatUSD(6191500)).toBe("$61,915.00");
    expect(formatUSD(100000000)).toBe("$1,000,000.00");
    expect(formatAmount(234000)).toBe("2,340.00");
  });
  it("sums without float drift", () => {
    expect(sumCents([10, 20, 30])).toBe(60);
    expect(sumCents([])).toBe(0);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(centsToDollars(1234)).toBe(12.34);
  });
  it("parses", () => {
    expect(parseDollars("$1,234.56")).toBe(123456);
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("12.5")).toBe(1250);
    expect(parseDollars("(12.00)")).toBe(-1200);
    expect(parseDollars("-3.07")).toBe(-307);
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(parseDollars("")).toBeNull();
  });
  it("assertCents and rate math", () => {
    expect(assertCents(5)).toBe(5);
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(mulRateCents(100000, 0.12, 0.5)).toBe(6000);
    expect(mulRateCents(-100000, 0.12, 0.5)).toBe(-6000);
  });
});
