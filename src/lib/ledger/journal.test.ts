import { describe, expect, it } from "vitest";
import { buildJournal } from "./journal";
import { allMovements } from "./movements";
import { item } from "./test-items";

const TODAY = "2026-11-01";
const remit = (reportId: string, remittedOn: string) => ({ remittance: { reportId, remittedOn, reference: "WIRE-9" } });

const items = [
  item({ state: "TX", propertyType: "vendor_check", amountCents: 45_051 }),
  item({ state: "TX", propertyType: "payroll_check", amountCents: 77_374, status: "remitted", classification: remit("rep-tx", "2026-11-01") }),
  item({ state: "CA", propertyType: "customer_credit", amountCents: 12_345 }),
  item({ state: "CA", propertyType: "customer_credit", amountCents: 1 }),
  item({ state: "DE", propertyType: "unapplied_cash", amountCents: 99_999, status: "resolved_paid", classification: { resolution: { at: "2026-10-01" } } }),
  item({ state: "DE", propertyType: "vendor_check", amountCents: 500, status: "resolved_paid", lateClearDate: "2026-09-01" }),
];
const ms = allMovements(items, [], TODAY);
const journal = buildJournal(ms, new Map([["rep-tx", { confirmation: "REPL-TX-2026-ABC123", unverifiedRuleCount: 2 }]]));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("buildJournal", () => {
  it("balances: debits equal credits per entry, per state and in total", () => {
    for (const e of journal.entries) {
      expect(sum(e.lines.map((l) => l.debitCents))).toBe(sum(e.lines.map((l) => l.creditCents)));
      expect(e.balanced).toBe(true);
    }
    for (const s of journal.byState) expect(s.debitCents).toBe(s.creditCents);
    expect(journal.balanced).toBe(true);
    expect(journal.debitCents).toBe(sum(ms.map((m) => m.amountCents)));
  });

  it("one entry per state and property type (and per report for remittances), numbered in date order", () => {
    const ca = journal.entries.filter((e) => e.state === "CA");
    expect(ca).toHaveLength(1);
    expect(ca[0]!.lines[0]!.debitCents).toBe(12_346);
    expect(ca[0]!.memo).toContain("2 items");
    expect(journal.entries.map((e) => e.je)).toEqual(journal.entries.map((_, i) => `JE-${String(i + 1).padStart(3, "0")}`));
    const dates = journal.entries.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("maps credits to the right accounts", () => {
    const find = (state: string, type: string, kind: string) => journal.entries.find((e) => e.state === state && e.propertyType === type && e.kind === kind)!;
    // Void stale check: Dr Cash, Cr UP payable (TX).
    const voided = find("TX", "vendor_check", "identified");
    expect(voided.lines.map((l) => [l.account.name, l.debitCents, l.creditCents])).toEqual([
      ["Cash", 45_051, 0],
      ["Unclaimed property payable (TX)", 0, 45_051],
    ]);
    // Customer credit: Dr AR credit balances; unapplied cash: Dr Unapplied cash; both Cr UP payable (state).
    expect(find("CA", "customer_credit", "identified").lines[0]!.account.name).toBe("AR credit balances");
    expect(find("CA", "customer_credit", "identified").lines[1]!.account.code).toBe("2400-CA");
    expect(find("DE", "unapplied_cash", "identified").lines[0]!.account.name).toBe("Unapplied cash");
    // Remit / reissue / late clear: Dr UP payable, Cr Cash.
    for (const e of [find("TX", "payroll_check", "remitted"), find("DE", "unapplied_cash", "resolved"), find("DE", "vendor_check", "cleared_late")]) {
      expect(e.lines[0]).toMatchObject({ account: { code: `2400-${e.state}` }, creditCents: 0 });
      expect(e.lines[1]).toMatchObject({ account: { name: "Cash" }, debitCents: 0 });
    }
  });

  it("a remittance cites the replica confirmation and the reference, and is UNVERIFIED when its filing relied on unverified rules", () => {
    const r = journal.entries.find((e) => e.kind === "remitted")!;
    expect(r.ref).toBe("REPL-TX-2026-ABC123 / WIRE-9");
    expect(r.date).toBe("2026-11-01");
    expect(r.unverified).toBe(true);
    // Recognition is a business threshold, never an UNVERIFIED rule figure.
    expect(journal.entries.filter((e) => e.kind !== "remitted").every((e) => !e.unverified)).toBe(true);
  });

  it("is empty and balanced with no movements", () => {
    expect(buildJournal([])).toEqual({ entries: [], byState: [], debitCents: 0, creditCents: 0, balanced: true });
  });
});
