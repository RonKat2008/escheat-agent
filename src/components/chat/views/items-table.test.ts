import { describe, expect, it } from "vitest";
import type { StaleItemRow } from "@/lib/queries/schemas";
import { filterItems, nextSort, sortItems, statusCounts } from "./items-table";

const row = (id: string, payeeName: string, cents: number, ageDays: number, status: string, deadline: string | null, checkNumber: string | null = id): StaleItemRow =>
  ({
    id,
    payeeName,
    checkNumber,
    amount: { cents, formatted: `$${cents / 100}` },
    ageDays,
    status,
    ownerState: "CA",
    nextDeadline: deadline ? { date: deadline, verified: false } : null,
  }) as unknown as StaleItemRow;

const ITEMS = [
  row("10482", "Bayline Electric", 234000, 426, "watching", "2028-10-31"),
  row("10087", "Ravenhill Cabinetry", 219470, 1077, "dd_pending", "2026-11-01"),
  row("10327", "Callum Whitlock", 157410, 695, "to_report", "2026-11-02"),
  row("UC-1", "Zinnia Court Market", 219470, 300, "watching", null, null),
];

describe("chat items table", () => {
  it("sorts without mutating, keeps ties in tool order, and puts missing deadlines last", () => {
    const before = ITEMS.map((i) => i.id);
    expect(sortItems(ITEMS, { key: "amount", dir: -1 }).map((i) => i.id)).toEqual(["10482", "10087", "UC-1", "10327"]);
    expect(sortItems(ITEMS, { key: "deadline", dir: 1 }).map((i) => i.id)).toEqual(["10087", "10327", "10482", "UC-1"]);
    expect(sortItems(ITEMS, { key: "payee", dir: 1 })[0]!.payeeName).toBe("Bayline Electric");
    expect(ITEMS.map((i) => i.id)).toEqual(before);
  });

  it("flips the active column and starts new columns in their natural direction", () => {
    expect(nextSort({ key: "amount", dir: -1 }, "amount")).toEqual({ key: "amount", dir: 1 });
    expect(nextSort({ key: "amount", dir: -1 }, "payee")).toEqual({ key: "payee", dir: 1 });
    expect(nextSort({ key: "payee", dir: 1 }, "age")).toEqual({ key: "age", dir: -1 });
  });

  it("filters by payee or check number (with or without #) and by status", () => {
    expect(filterItems(ITEMS, { query: "#10482", status: null }).map((i) => i.id)).toEqual(["10482"]);
    expect(filterItems(ITEMS, { query: "raven", status: null }).map((i) => i.id)).toEqual(["10087"]);
    expect(filterItems(ITEMS, { query: "", status: "watching" }).map((i) => i.id)).toEqual(["10482", "UC-1"]);
    expect(filterItems(ITEMS, { query: "bayline", status: "to_report" })).toEqual([]);
  });

  it("counts statuses most common first", () => {
    expect(statusCounts(ITEMS)).toEqual([
      { status: "watching", count: 2 },
      { status: "dd_pending", count: 1 },
      { status: "to_report", count: 1 },
    ]);
  });
});
