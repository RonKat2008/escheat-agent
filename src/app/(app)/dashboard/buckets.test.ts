import { describe, expect, it } from "vitest";
import { heroBuckets } from "./buckets";

const row = (status: string, count: number, cents: number) => ({ status, count, cents, formatted: "" }) as never;

describe("heroBuckets", () => {
  it("splits unfiled exposure by action and adds up to the headline", () => {
    const byStatus = [row("to_report", 2, 5000), row("dd_pending", 3, 3000), row("dd_sent", 1, 400), row("owner_responded", 1, 100), row("watching", 10, 90000), row("needs_rule", 1, 7)];
    const b = heroBuckets(byStatus);
    expect(b.map((x) => x.id)).toEqual(["reportable", "letters_due", "awaiting_owner", "watching", "needs_rule"]);
    expect(b.find((x) => x.id === "awaiting_owner")).toMatchObject({ count: 2, cents: 500 });
    expect(b.reduce((a, x) => a + x.cents, 0)).toBe(5000 + 3000 + 400 + 100 + 90000 + 7);
  });
  it("drops empty buckets and never invents a filed bucket", () => {
    const b = heroBuckets([row("watching", 4, 10), row("reported", 1, 99)]);
    expect(b.map((x) => x.id)).toEqual(["watching"]);
  });
});
