import { describe, expect, it } from "vitest";
import { reconcile, isStale, type ReconClear, type ReconLedgerItem } from "./reconcile";

const ASOF = "2025-06-30";
let n = 0;
const chk = (o: Partial<ReconLedgerItem> = {}): ReconLedgerItem => ({
  id: `L${++n}`,
  kind: "check",
  number: null,
  amountCents: 10000,
  issueDate: "2025-01-01",
  voided: false,
  ...o,
});
const clr = (o: Partial<ReconClear> = {}): ReconClear => ({
  id: `C${++n}`,
  checkNumber: null,
  amountCents: 10000,
  clearedDate: "2025-02-01",
  ...o,
});

describe("reconcile: number + amount", () => {
  it("matches by check number and exact amount", () => {
    const l = chk({ id: "a", number: "1001" });
    const c = clr({ id: "x", checkNumber: "1001" });
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([{ ledgerId: "a", clearId: "x", method: "number_and_amount" }]);
    expect(r.outstanding).toEqual([]);
    expect(r.unmatchedClears).toEqual([]);
  });

  it("ignores leading zeros and case in numbers", () => {
    const r = reconcile([chk({ id: "a", number: "001001" })], [clr({ id: "x", checkNumber: "1001" })], ASOF);
    expect(r.matched).toHaveLength(1);
  });

  it("flags amount mismatch on the same number as ambiguous, not matched", () => {
    const l = chk({ id: "a", number: "1001", amountCents: 10000 });
    const c = clr({ id: "x", checkNumber: "1001", amountCents: 9000 });
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toEqual([{ ledgerId: "a", candidates: ["x"], reason: "amount_mismatch" }]);
    expect(r.outstanding).toEqual([]);
    expect(r.unmatchedClears).toEqual([]);
  });

  it("outstanding when no clear exists, with ageDays", () => {
    const r = reconcile([chk({ id: "a", number: "1", issueDate: "2025-01-01" })], [], ASOF);
    expect(r.outstanding).toHaveLength(1);
    expect(r.outstanding[0]).toMatchObject({ id: "a", ageDays: 180 });
  });

  it("uses each clear at most once: a duplicate clear stays unmatched", () => {
    const l = chk({ id: "a", number: "1" });
    const c1 = clr({ id: "x", checkNumber: "1", clearedDate: "2025-02-01" });
    const c2 = clr({ id: "y", checkNumber: "1", clearedDate: "2025-02-05" });
    const r = reconcile([l], [c2, c1], ASOF);
    expect(r.matched).toEqual([{ ledgerId: "a", clearId: "x", method: "number_and_amount" }]);
    expect(r.unmatchedClears.map((c) => c.id)).toEqual(["y"]);
  });

  it("does not match a clear dated before the issue date", () => {
    const l = chk({ id: "a", number: "1", issueDate: "2025-03-01" });
    const c = clr({ id: "x", checkNumber: "1", clearedDate: "2025-02-01" });
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.outstanding.map((o) => o.id)).toEqual(["a"]);
    expect(r.unmatchedClears.map((o) => o.id)).toEqual(["x"]);
  });

  it("ignores clears after asOf (item stays outstanding, clear not reported)", () => {
    const l = chk({ id: "a", number: "1" });
    const c = clr({ id: "x", checkNumber: "1", clearedDate: "2025-07-15" });
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.outstanding.map((o) => o.id)).toEqual(["a"]);
    expect(r.unmatchedClears).toEqual([]);
  });

  it("ignores items issued after asOf", () => {
    const r = reconcile([chk({ id: "a", issueDate: "2025-08-01" })], [], ASOF);
    expect(r.outstanding).toEqual([]);
  });

  it("two checks with same amount but different numbers each match their own clear", () => {
    const a = chk({ id: "a", number: "1" });
    const b = chk({ id: "b", number: "2" });
    const r = reconcile([a, b], [clr({ id: "y", checkNumber: "2" }), clr({ id: "x", checkNumber: "1" })], ASOF);
    expect(r.matched).toEqual(
      expect.arrayContaining([
        { ledgerId: "a", clearId: "x", method: "number_and_amount" },
        { ledgerId: "b", clearId: "y", method: "number_and_amount" },
      ]),
    );
  });

  it("duplicate ledger numbers with identical amounts sharing one clear are ambiguous", () => {
    const a = chk({ id: "a", number: "7" });
    const b = chk({ id: "b", number: "7" });
    const r = reconcile([a, b], [clr({ id: "x", checkNumber: "7" })], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous.map((x) => x.ledgerId).sort()).toEqual(["a", "b"]);
  });
});

describe("reconcile: amount + date proximity (no number on clear)", () => {
  it("matches a single unnumbered clear by amount within the window", () => {
    const l = chk({ id: "a", number: "1", amountCents: 12345 });
    const c = clr({ id: "x", amountCents: 12345, clearedDate: "2025-03-01" });
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([{ ledgerId: "a", clearId: "x", method: "amount_and_date" }]);
  });

  it("marks ambiguous when two checks tie on distance, never guessing", () => {
    const a = chk({ id: "a", number: "1", issueDate: "2025-01-01" });
    const b = chk({ id: "b", number: "2", issueDate: "2025-01-01" });
    const r = reconcile([a, b], [clr({ id: "x", clearedDate: "2025-02-01" })], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous.map((x) => [x.ledgerId, x.reason])).toEqual([
      ["a", "multiple_candidate_checks"],
      ["b", "multiple_candidate_checks"],
    ]);
    expect(r.outstanding).toEqual([]);
    expect(r.unmatchedClears).toEqual([]);
  });

  it("picks the closest check when strictly closer", () => {
    const far = chk({ id: "far", issueDate: "2025-01-01" });
    const near = chk({ id: "near", issueDate: "2025-01-20" });
    const r = reconcile([far, near], [clr({ id: "x", clearedDate: "2025-02-01" })], ASOF);
    expect(r.matched).toEqual([{ ledgerId: "near", clearId: "x", method: "amount_and_date" }]);
    expect(r.outstanding.map((o) => o.id)).toEqual(["far"]);
  });

  it("respects ambiguityMarginDays", () => {
    const far = chk({ id: "far", issueDate: "2025-01-15" });
    const near = chk({ id: "near", issueDate: "2025-01-20" });
    const r = reconcile([far, near], [clr({ clearedDate: "2025-02-01" })], ASOF, { ambiguityMarginDays: 7 });
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toHaveLength(2);
  });

  it("does not match a late clear beyond maxClearDays", () => {
    const l = chk({ id: "a", issueDate: "2024-01-01" });
    const c = clr({ id: "x", clearedDate: "2025-03-01" }); // 424 days
    const r = reconcile([l], [c], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.outstanding.map((o) => o.id)).toEqual(["a"]);
    expect(r.unmatchedClears.map((o) => o.id)).toEqual(["x"]);
    expect(reconcile([l], [c], ASOF, { maxClearDays: 500 }).matched).toHaveLength(1);
  });

  it("does not match an unnumbered clear dated before issue", () => {
    const r = reconcile([chk({ id: "a", issueDate: "2025-03-01" })], [clr({ clearedDate: "2025-02-01" })], ASOF);
    expect(r.matched).toEqual([]);
  });

  it("a second unnumbered clear for an already matched check stays unmatched", () => {
    const r = reconcile(
      [chk({ id: "a" })],
      [clr({ id: "x", clearedDate: "2025-02-01" }), clr({ id: "y", clearedDate: "2025-02-02" })],
      ASOF,
    );
    expect(r.matched).toHaveLength(1);
    expect(r.unmatchedClears.map((c) => c.id)).toEqual(["y"]);
  });

  it("assigns two same-amount checks to two clears when only one fits each", () => {
    const a = chk({ id: "a", issueDate: "2025-01-01" });
    const b = chk({ id: "b", issueDate: "2025-03-01" });
    const r = reconcile([a, b], [clr({ id: "x", clearedDate: "2025-02-01" }), clr({ id: "y", clearedDate: "2025-04-01" })], ASOF);
    expect(r.matched).toEqual(
      expect.arrayContaining([
        { ledgerId: "a", clearId: "x", method: "amount_and_date" },
        { ledgerId: "b", clearId: "y", method: "amount_and_date" },
      ]),
    );
  });

  it("does not amount-match a clear whose number is unknown to the ledger", () => {
    const r = reconcile([chk({ id: "a", number: "1" })], [clr({ id: "x", checkNumber: "999" })], ASOF);
    expect(r.matched).toEqual([]);
    expect(r.unmatchedClears.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("reconcile: voids and credits", () => {
  it("reports voided items and never matches them", () => {
    const v = chk({ id: "v", number: "1", voided: true });
    const r = reconcile([v], [clr({ id: "x", checkNumber: "1" })], ASOF);
    expect(r.voided.map((x) => x.id)).toEqual(["v"]);
    expect(r.matched).toEqual([]);
    expect(r.outstanding).toEqual([]);
    expect(r.unmatchedClears.map((c) => c.id)).toEqual(["x"]);
  });

  it("credits and unapplied cash are outstanding unless voided, and never cleared by bank clears", () => {
    const credit = chk({ id: "c", kind: "credit", amountCents: -5000 });
    const cash = chk({ id: "u", kind: "unapplied_cash", amountCents: 7000 });
    const voidedCredit = chk({ id: "vc", kind: "credit", voided: true });
    const r = reconcile(
      [credit, cash, voidedCredit],
      [clr({ amountCents: -5000 }), clr({ amountCents: 7000 })],
      ASOF,
    );
    expect(r.matched).toEqual([]);
    expect(r.outstanding.map((o) => o.id)).toEqual(["c", "u"]);
    expect(r.voided.map((o) => o.id)).toEqual(["vc"]);
    expect(r.unmatchedClears).toHaveLength(2);
  });

  it("preserves extra fields on outstanding items", () => {
    const l = { ...chk({ id: "a" }), payeeId: "P1" };
    const r = reconcile([l], [], ASOF);
    expect(r.outstanding[0]!.payeeId).toBe("P1");
  });
});

describe("isStale", () => {
  const item = { issueDate: "2025-01-01" };
  it("exactly the threshold is not stale; one day more is", () => {
    expect(isStale(item, "2025-06-30", 180)).toBe(false); // 180 days
    expect(isStale(item, "2025-07-01", 180)).toBe(true); // 181 days
  });
  it("future-dated items are not stale", () => {
    expect(isStale(item, "2024-12-01", 180)).toBe(false);
  });
});
