import { describe, expect, it } from "vitest";
import { buildJournal } from "./journal";
import { allMovements } from "./movements";
import { periodFor, rollForward } from "./rollforward";
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

  it("one entry per state, property type and month (and per report for remittances), dated in date order", () => {
    const ca = journal.entries.filter((e) => e.state === "CA");
    expect(ca).toHaveLength(1);
    expect(ca[0]!.lines[0]!.debitCents).toBe(12_346);
    expect(ca[0]!.memo).toContain("2 items");
    expect(ca[0]!.je).toBe("JE-CA-202603-01");
    for (const e of journal.entries) expect(e.je).toMatch(/^JE-[A-Z]+-\d{6}-\d{2}$/);
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

  it("never spans months: an entry is dated inside the month of every item it covers", () => {
    const mixed = allMovements(
      [
        item({ state: "TX", staleSince: "2026-02-10" }),
        item({ state: "TX", staleSince: "2026-02-27" }),
        item({ state: "TX", staleSince: "2026-09-24" }),
        item({ state: "TX", staleSince: "2026-11-01" }),
      ],
      [],
      TODAY,
    );
    const j = buildJournal(mixed);
    expect(j.entries.map((e) => [e.date.slice(0, 7), e.itemIds.length])).toEqual([
      ["2026-02", 2],
      ["2026-09", 1],
      ["2026-11", 1],
    ]);
    const byId = new Map(mixed.map((m) => [m.itemId, m.date]));
    for (const e of j.entries) for (const id of e.itemIds) expect(byId.get(id)!.slice(0, 7)).toBe(e.date.slice(0, 7));
  });

  it("JE numbers are globally unique and identical across period exports", () => {
    const entriesFor = (id: "month" | "quarter" | "fy") => buildJournal(rollForward(ms, periodFor(id, TODAY, "12-31", null)).movements).entries;
    const fy = entriesFor("fy");
    expect(new Set(fy.map((e) => e.je)).size).toBe(fy.length);
    const month = entriesFor("month");
    expect(month.length).toBeGreaterThan(0);
    const fyByJe = new Map(fy.map((e) => [e.je, e]));
    for (const e of month) expect(fyByJe.get(e.je)).toEqual(e);
  });

  it("is deterministic: the same movements in any order give the same numbers", () => {
    const again = buildJournal([...ms].reverse(), new Map([["rep-tx", { confirmation: "REPL-TX-2026-ABC123", unverifiedRuleCount: 2 }]]));
    expect(again.entries.map((e) => [e.je, e.date])).toEqual(journal.entries.map((e) => [e.je, e.date]));
  });

  it("is empty and balanced with no movements", () => {
    expect(buildJournal([])).toEqual({ entries: [], byState: [], debitCents: 0, creditCents: 0, balanced: true });
  });
});

describe("period exports tie to the roll-forward", () => {
  const many = allMovements(
    [
      item({ state: "TX", amountCents: 100_00, staleSince: "2026-01-15" }),
      item({ state: "TX", amountCents: 250_51, staleSince: "2026-03-02" }),
      item({ state: "TX", amountCents: 45_051, staleSince: "2026-10-12" }),
      item({ state: "TX", amountCents: 7_00, staleSince: "2026-11-01" }),
      item({ state: "CA", amountCents: 3_10, staleSince: "2026-02-03" }),
      item({ state: "CA", amountCents: 9_99, staleSince: "2026-09-24" }),
      item({ state: "CA", amountCents: 4_00, staleSince: "2026-09-02", status: "remitted", classification: remit("rep-ca", "2026-10-20") }),
      item({ state: "DE", propertyType: "unapplied_cash", amountCents: 8_88, staleSince: "2026-06-30", status: "resolved_paid", classification: { resolution: { at: "2026-11-02" } } }),
    ],
    [],
    TODAY,
  );
  const exportFor = (id: "month" | "quarter" | "fy", today = TODAY) => {
    const rf = rollForward(many, periodFor(id, today, "12-31", null));
    return { rf, journal: buildJournal(rf.movements) };
  };
  const debitBy = (j: ReturnType<typeof buildJournal>, kind: string) => sum(j.entries.filter((e) => e.kind === kind).map((e) => e.lines[0]!.debitCents + e.lines[1]!.debitCents));

  it("FY entries tie to the FY roll-forward flows, and each entry sits in the period it was identified", () => {
    const { rf, journal: fy } = exportFor("fy");
    const identified = sum(fy.entries.filter((e) => e.kind === "identified").map((e) => e.lines[1]!.creditCents));
    expect(identified).toBe(rf.total.identified);
    expect(sum(fy.entries.filter((e) => e.kind === "resolved").map((e) => e.lines[0]!.debitCents))).toBe(rf.total.resolved);
    expect(sum(fy.entries.filter((e) => e.kind === "remitted").map((e) => e.lines[0]!.debitCents))).toBe(rf.total.remitted);
    expect(debitBy(fy, "identified")).toBeGreaterThan(0);
    for (const e of fy.entries) {
      expect(e.date >= rf.period.start && e.date <= rf.period.end).toBe(true);
    }
  });

  it("the November entries equal the month roll-forward, not the whole group", () => {
    const { rf, journal: month } = exportFor("month");
    const identified = sum(month.entries.filter((e) => e.kind === "identified").map((e) => e.lines[1]!.creditCents));
    expect(identified).toBe(rf.total.identified);
    expect(identified).toBe(7_00);
  });

  it("the sum of the monthly exports equals the FY export (entries, JE numbers and amounts)", () => {
    const fy = exportFor("fy").journal;
    const monthly = [];
    for (let m = 1; m <= 11; m++) {
      const last = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      const to = m === 11 ? TODAY : `2026-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
      const rf = rollForward(many, { id: "month", label: "m", start: `2026-${String(m).padStart(2, "0")}-01`, end: to });
      monthly.push(...buildJournal(rf.movements).entries);
    }
    const key = (e: { je: string }) => e.je;
    expect(monthly.map(key).sort()).toEqual(fy.entries.map(key).sort());
    expect(new Set(monthly.map(key)).size).toBe(monthly.length);
    const total = (es: readonly { lines: { debitCents: number }[] }[]) => sum(es.flatMap((e) => e.lines.map((l) => l.debitCents)));
    expect(total(monthly)).toBe(total(fy.entries));
    const byJe = new Map(fy.entries.map((e) => [e.je, e]));
    for (const e of monthly) expect(byJe.get(e.je)).toEqual(e);
  });
});
