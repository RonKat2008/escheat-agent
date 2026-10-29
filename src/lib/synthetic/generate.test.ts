import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { buildBundle, json } from "./build";
import { daysBetween } from "./dates";
import { clearedDateIndex, computeDemoStats, isStaleAt, resolveOwnerState } from "./labels";
import { DEFAULT_SEED, DEMO_ANCHOR_DATE } from "./model";

const bundle = buildBundle();
const { ledger, clears } = bundle.dataset;
const stats = computeDemoStats(ledger, clears, DEMO_ANCHOR_DATE);
const fixture = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("determinism", () => {
  it("same seed gives byte-identical output", () => {
    const again = buildBundle(DEFAULT_SEED);
    expect(again.ledgerCsv).toBe(bundle.ledgerCsv);
    expect(again.clearsCsv).toBe(bundle.clearsCsv);
    expect(json(again.generatedCases)).toBe(json(bundle.generatedCases));
    expect(json(again.replica)).toBe(json(bundle.replica));
  });

  it("a different seed gives different data", () => {
    const other = buildBundle(7);
    expect(other.ledgerCsv).not.toBe(bundle.ledgerCsv);
    expect(other.clearsCsv).not.toBe(bundle.clearsCsv);
  });

  it("committed fixtures equal fresh generation at the default seed", () => {
    expect(fixture("fixtures/synthetic/ledger.csv")).toBe(bundle.ledgerCsv);
    expect(fixture("fixtures/synthetic/bank_clears.csv")).toBe(bundle.clearsCsv);
    expect(fixture("fixtures/eval/cases.generated.json")).toBe(json(bundle.generatedCases));
    expect(fixture("fixtures/eval/cases.adversarial.json")).toBe(json(bundle.adversarialCases));
    expect(fixture("fixtures/replica/search-records.json")).toBe(json(bundle.replica));
  });
});

describe("demo invariants at the anchor date", () => {
  it("has exactly 47 stale items totaling $61,915.00", () => {
    expect(stats.staleCount).toBe(47);
    expect(stats.staleTotalCents).toBe(6_191_500);
  });

  it("splits owner states CA 21 / TX 15 / DE 11 and nothing else", () => {
    expect(stats.byOwnerState).toEqual({ CA: 21, TX: 15, DE: 11 });
  });

  it("has per-state exposure CA $28,410.00 / TX $19,862.00 / DE $13,643.00", () => {
    expect(stats.byOwnerStateCents).toEqual({ CA: 2_841_000, TX: 1_986_200, DE: 1_364_300 });
  });

  it("reconciles with no ambiguous items under the production reconcile()", () => {
    expect(stats.ambiguousCount).toBe(0);
  });

  it("includes no-address stale items that fall back to DE by incorporation", () => {
    const blank = stats.staleRows.filter((r) => !r.payee_address && !r.payee_city && !r.payee_state && !r.payee_zip);
    expect(blank.length).toBeGreaterThanOrEqual(4);
    for (const r of blank) {
      expect(resolveOwnerState(r)).toMatchObject({ owner_state: "DE", owner_state_basis: "incorporation" });
    }
  });

  it("has the featured check #10482, $2,340.00, Bayline Electric, CA, 2025-09-01, never cleared", () => {
    const item = ledger.find((r) => r.number === "10482");
    expect(item).toMatchObject({
      kind: "vendor_check",
      payee_name: "Bayline Electric",
      amount_cents: 234_000,
      issue_date: "2025-09-01",
      voided: false,
      payee_state: "CA",
    });
    expect(item?.payee_address).toBeTruthy();
    expect(item?.payee_city).toBeTruthy();
    expect(item?.payee_zip).toMatch(/^\d{5}$/);
    expect(clearedDateIndex(clears).has("10482")).toBe(false);
    expect(stats.staleRows.some((r) => r.number === "10482")).toBe(true);
  });

  it("never marks other-state payees stale", () => {
    for (const r of stats.staleRows) expect(["CA", "TX", "DE"]).toContain(resolveOwnerState(r).owner_state);
    const otherStates = new Set(
      ledger.map((r) => r.payee_state).filter((s) => s && !["CA", "TX", "DE", "ON"].includes(s)),
    );
    expect([...otherStates].sort()).toEqual(expect.arrayContaining(["NY", "WA", "IL", "FL"]));
  });

  it("is anchored on the 180-day boundary (180 days old is not stale, 181 is)", () => {
    const idx = clearedDateIndex(clears);
    const open = (age: number) =>
      ledger.find((r) => daysBetween(r.issue_date, DEMO_ANCHOR_DATE) === age && !r.voided && !idx.has(r.number));
    const on180 = open(180);
    const on181 = open(181);
    expect(on180).toBeDefined();
    expect(on181).toBeDefined();
    expect(stats.staleRows).not.toContain(on180);
    expect(stats.staleRows).toContain(on181);
  });
});

describe("dataset realism", () => {
  it("has 600-900 ledger items, mostly vendor checks, with matching clears", () => {
    expect(ledger.length).toBeGreaterThanOrEqual(600);
    expect(ledger.length).toBeLessThanOrEqual(900);
    const vendor = ledger.filter((r) => r.kind === "vendor_check").length;
    expect(vendor / ledger.length).toBeGreaterThan(0.6);
    for (const kind of ["payroll_check", "customer_credit", "unapplied_cash"] as const) {
      expect(ledger.some((r) => r.kind === kind)).toBe(true);
    }
    const numbers = new Set(ledger.map((r) => r.number));
    expect(numbers.size).toBe(ledger.length);
    for (const c of clears) {
      const item = ledger.find((r) => r.number === c.check_number);
      expect(item?.amount_cents).toBe(c.amount_cents);
      expect(item?.voided).toBe(false);
      expect(c.cleared_date <= DEMO_ANCHOR_DATE).toBe(true);
    }
  });

  it("spans three years before the anchor", () => {
    const dates = ledger.map((r) => r.issue_date).sort();
    expect(daysBetween(dates[0] as string, DEMO_ANCHOR_DATE)).toBeGreaterThan(1050);
    expect(dates[dates.length - 1] as string <= DEMO_ANCHOR_DATE).toBe(true);
  });

  it("contains the intended mess", () => {
    expect(ledger.filter((r) => r.voided).length).toBeGreaterThanOrEqual(10);
    const idx = clearedDateIndex(clears);
    const late = ledger.filter((r) => {
      const c = idx.get(r.number);
      return c !== undefined && daysBetween(r.issue_date, c) >= 60;
    });
    expect(late.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...late.map((r) => daysBetween(r.issue_date, idx.get(r.number) as string)))).toBeLessThanOrEqual(200);

    const names = new Set(ledger.map((r) => r.payee_name));
    expect(names.has("Bayline Electric")).toBe(true);
    expect(names.has("Bayline Electric Inc.")).toBe(true);
    expect(names.has("BAYLINE ELEC")).toBe(true);

    const byAmount = new Map<number, Set<string>>();
    for (const r of ledger.filter((x) => x.kind === "vendor_check")) {
      byAmount.set(r.amount_cents, (byAmount.get(r.amount_cents) ?? new Set()).add(r.number));
    }
    expect([...byAmount.values()].filter((s) => s.size > 1).length).toBeGreaterThan(5);

    const has = (f: (r: (typeof ledger)[number]) => boolean) => ledger.some(f);
    expect(has((r) => !r.payee_address && !r.payee_city && !r.payee_state && !r.payee_zip)).toBe(true);
    expect(has((r) => !r.payee_address && !!r.payee_city && !r.payee_state && !r.payee_zip)).toBe(true);
    expect(has((r) => !r.payee_address && !r.payee_city && !r.payee_state && !!r.payee_zip)).toBe(true);
  });

  it("stale items include same-amount twins cleared under a different number", () => {
    const idx = clearedDateIndex(clears);
    const twins = stats.staleRows.filter((s) =>
      ledger.some(
        (o) => o.number !== s.number && o.payee_name.slice(0, 6) === s.payee_name.slice(0, 6) && o.amount_cents === s.amount_cents && idx.has(o.number),
      ),
    );
    expect(twins.length).toBeGreaterThanOrEqual(4);
  });

  it("contains no SSN/TIN/bank-number-looking values", () => {
    const text = `${bundle.ledgerCsv}\n${bundle.clearsCsv}\n${JSON.stringify(bundle.replica)}`;
    expect(text).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN
    expect(text).not.toMatch(/\b\d{2}-\d{7}\b/); // EIN/TIN
    expect(text).not.toMatch(/(?<![\d.])\d{9,}(?![\d.])/); // 9+ digit runs (routing/account numbers)
    expect(bundle.dataset.company.fein).toBeNull();
  });

  it("ledger.csv and bank_clears.csv parse back to the same rows", () => {
    const rows = parse(bundle.ledgerCsv, { columns: true }) as Array<Record<string, string>>;
    expect(Object.keys(rows[0] as object)).toEqual([
      "kind", "number", "payee_name", "payee_address", "payee_city", "payee_state", "payee_zip",
      "amount", "issue_date", "voided", "memo",
    ]);
    expect(rows).toHaveLength(ledger.length);
    const featured = rows.find((r) => r.number === "10482");
    expect(featured?.amount).toBe("2340.00");
    const bank = parse(bundle.clearsCsv, { columns: true }) as Array<Record<string, string>>;
    expect(Object.keys(bank[0] as object)).toEqual(["check_number", "amount", "cleared_date", "description"]);
    expect(bank).toHaveLength(clears.length);
    const idx = clearedDateIndex(clears);
    const rebuilt = rows
      .filter((r) => r.voided !== "true")
      .map((r) => ({ issue_date: r.issue_date as string, cleared_date: idx.get(r.number as string) ?? null }))
      .filter((r) => isStaleAt(r, DEMO_ANCHOR_DATE));
    expect(rebuilt).toHaveLength(47);
  });

  it("keeps the invariants for other seeds", () => {
    for (const seed of [1, 99, 123456]) {
      const d = buildBundle(seed).dataset;
      const s = computeDemoStats(d.ledger, d.clears, DEMO_ANCHOR_DATE);
      expect([s.staleCount, s.staleTotalCents]).toEqual([47, 6_191_500]);
      expect(s.byOwnerState).toEqual({ CA: 21, TX: 15, DE: 11 });
      expect(s.byOwnerStateCents).toEqual({ CA: 2_841_000, TX: 1_986_200, DE: 1_364_300 });
      expect(d.ledger.find((r) => r.number === "10482")?.amount_cents).toBe(234_000);
    }
  });
});

describe("replica search fixture", () => {
  it("has ~30 records per state and exactly one $1,180.00 Northwind record, in TX", () => {
    for (const st of ["CA", "DE", "TX"] as const) {
      expect(bundle.replica.records[st]).toHaveLength(30);
    }
    const hits = (["CA", "DE", "TX"] as const).flatMap((st) =>
      bundle.replica.records[st].filter((r) => r.amount_cents === 118_000),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ owner_name: "NORTHWIND FIXTURES INC", state_held: "TX", synthetic: true });
    expect(hits[0]?.reported_by).toBeTruthy();
    expect(hits[0]?.property_type).toBeTruthy();
    expect(hits[0]?.property_id).toMatch(/^SYN-TX-/);
    const all = (["CA", "DE", "TX"] as const).flatMap((st) => bundle.replica.records[st]);
    expect(new Set(all.map((r) => r.property_id)).size).toBe(all.length);
    expect(bundle.replica.synthetic).toBe(true);
  });
});
