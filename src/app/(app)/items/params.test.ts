import { describe, expect, it } from "vitest";
import { loadItemsParams } from "./params";
import { activeSort, isSortableColumn, nextSort } from "./sort";

describe("loadItemsParams", () => {
  it("ignores unknown enum values instead of throwing", () => {
    const p = loadItemsParams({ status: "dd_due", type: "bogus", sort: "nope", minAge: "-5", state: "TEXAS" });
    expect(p).toMatchObject({ status: null, type: null, sort: null, minAge: null, state: null });
  });
  it("keeps valid values", () => {
    const p = loadItemsParams({ status: "dd_pending", type: "vendor_check", sort: "deadline_asc", minAge: "365", state: "ca", review: "true" });
    expect(p).toMatchObject({ status: "dd_pending", type: "vendor_check", sort: "deadline_asc", minAge: 365, state: "CA", review: true });
  });
  it("ignores non-numeric and fractional ages", () => {
    expect(loadItemsParams({ minAge: "abc" }).minAge).toBeNull();
    expect(loadItemsParams({ minAge: "1.5" }).minAge).toBeNull();
  });
});

describe("column sort <-> URL sort", () => {
  it("treats a missing sort as the default Issued column, oldest first", () => {
    expect(activeSort(null)).toEqual({ columnId: "age", dir: "desc" });
  });
  it("maps a sort value back to its column and direction", () => {
    expect(activeSort("amount_asc")).toEqual({ columnId: "amount", dir: "asc" });
    expect(activeSort("payee_desc")).toEqual({ columnId: "payee", dir: "desc" });
    expect(activeSort("deadline_asc")).toEqual({ columnId: "deadline", dir: "asc" });
  });
  it("first click picks the column's first direction, the second flips it", () => {
    expect(nextSort("amount", null)).toBe("amount_desc");
    expect(nextSort("amount", "amount_desc")).toBe("amount_asc");
    expect(nextSort("amount", "amount_asc")).toBe("amount_desc");
    expect(nextSort("payee", "amount_desc")).toBe("payee_asc");
    expect(nextSort("age", null)).toBe("age_asc");
  });
  it("only payee, amount, issued and deadline sort on the server", () => {
    expect(["payee", "amount", "age", "deadline"].every(isSortableColumn)).toBe(true);
    expect(["check", "state", "type", "status", "select"].some(isSortableColumn)).toBe(false);
  });
});
