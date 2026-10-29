import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { bankClears, companies, ledgerItems, payees } from "@/db/schema";
import {
  insertClearRows,
  insertLedgerRows,
  resolvePayees,
  runReconciliation,
} from "./persist";
import { ingestCsv } from "./ingest";
import { syntheticClearsMapping, syntheticLedgerMapping } from "./csv";
import type { ClearRow, LedgerRow } from "./schemas";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function newCompany(): Promise<string> {
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  return c!.id;
}

const row = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  kind: "check",
  payeeName: "Bayline Electric",
  amount: 234000,
  issueDate: "2024-08-14",
  voided: false,
  ...o,
});

describe("persist ledger + clears", () => {
  it("inserts ledger rows with mapped property types, status and csv source", async () => {
    const companyId = await newCompany();
    const res = await insertLedgerRows(
      t.db,
      companyId,
      [
        row({ number: "10482", payeeState: "CA" }),
        row({ kind: "credit", payeeName: "Northwind", amount: -500, number: undefined }),
        row({ kind: "unapplied_cash", payeeName: "Zed" }),
        row({ voided: true, number: "9", payeeName: "Acme" }),
      ],
      [{ a: "1" }],
    );
    expect(res).toEqual({ inserted: 4, skipped: 0 });
    const items = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(items.map((i) => i.propertyType).sort()).toEqual(
      ["customer_credit", "unapplied_cash", "vendor_check", "vendor_check"].sort(),
    );
    expect(items.find((i) => i.referenceNumber === "9")!.status).toBe("voided");
    expect(items.find((i) => i.referenceNumber === "10482")!.rawRow).toMatchObject({ a: "1", _source: "csv" });
  });

  it("is idempotent for identical rows and ignores other companies", async () => {
    const a = await newCompany();
    const b = await newCompany();
    const r = [row({ number: "1" })];
    expect((await insertLedgerRows(t.db, a, r)).inserted).toBe(1);
    expect(await insertLedgerRows(t.db, a, r)).toEqual({ inserted: 0, skipped: 1 });
    expect((await insertLedgerRows(t.db, b, r)).inserted).toBe(1);
  });

  it("inserts clears and dedupes", async () => {
    const companyId = await newCompany();
    const clears: ClearRow[] = [
      { checkNumber: "1", amount: 100, clearedDate: "2024-09-01" },
      { amount: 200, clearedDate: "2024-09-02", description: "x" },
    ];
    expect(await insertClearRows(t.db, companyId, clears)).toEqual({ inserted: 2, skipped: 0 });
    expect(await insertClearRows(t.db, companyId, clears)).toEqual({ inserted: 0, skipped: 2 });
  });
});

describe("resolvePayees", () => {
  it("clusters name variants into one payee with aliases, basis and confidence", async () => {
    const companyId = await newCompany();
    await insertLedgerRows(t.db, companyId, [
      row({ payeeName: "Bayline Electric", number: "1", payeeState: "CA" }),
      row({ payeeName: "BAYLINE ELECTRIC INC", number: "2", payeeState: "CA" }),
      row({ payeeName: "Bayline Elec., LLC", number: "3" }),
      row({ payeeName: "Zenith Roofing", number: "4" }),
    ]);
    const res = await resolvePayees(t.db, companyId);
    expect(res).toMatchObject({ payeesCreated: 2, itemsLinked: 4 });
    const ps = await t.db.select().from(payees).where(eq(payees.companyId, companyId));
    const bay = ps.find((x) => x.canonicalName === "Bayline Electric")!;
    expect(bay.aliases.sort()).toEqual(["BAYLINE ELECTRIC INC", "Bayline Elec., LLC"].sort());
    expect(bay.mergeBasis).toBe("exact");
    expect(bay.state).toBe("CA");
    const items = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(items.filter((i) => i.payeeId === bay.id)).toHaveLength(3);
    expect(items.every((i) => i.payeeId)).toBe(true);
  });

  it("links later imports to the existing payee instead of duplicating it", async () => {
    const companyId = await newCompany();
    await insertLedgerRows(t.db, companyId, [row({ number: "1" })]);
    await resolvePayees(t.db, companyId);
    await insertLedgerRows(t.db, companyId, [row({ payeeName: "Bayline Electric Co", number: "2" })]);
    const res = await resolvePayees(t.db, companyId);
    expect(res).toMatchObject({ payeesCreated: 0, payeesUpdated: 1, itemsLinked: 1 });
    const ps = await t.db.select().from(payees).where(eq(payees.companyId, companyId));
    expect(ps).toHaveLength(1);
    expect(ps[0]!.aliases).toContain("Bayline Electric Co");
  });
});

describe("runReconciliation", () => {
  it("matches, marks cleared, lists outstanding with payee ids, and ignores future clears", async () => {
    const companyId = await newCompany();
    await insertLedgerRows(t.db, companyId, [
      row({ number: "10482", amount: 234000, issueDate: "2024-04-01" }), // uncleared, featured
      row({ number: "10483", amount: 5000, issueDate: "2025-01-01", payeeName: "Cleared Co" }),
      row({ number: "10484", amount: 7000, issueDate: "2025-01-01", payeeName: "Late Co" }),
      row({ number: "10485", amount: 100, issueDate: "2025-01-01", payeeName: "Void Co", voided: true }),
      row({ kind: "credit", number: undefined, amount: -2500, issueDate: "2024-12-01", payeeName: "Credit Co" }),
    ]);
    await insertClearRows(t.db, companyId, [
      { checkNumber: "10483", amount: 5000, clearedDate: "2025-02-01" },
      { checkNumber: "10484", amount: 7000, clearedDate: "2025-09-01" }, // after asOf
      { checkNumber: "99999", amount: 1, clearedDate: "2025-02-01" },
    ]);
    await resolvePayees(t.db, companyId);

    const out = await runReconciliation(t.db, companyId, "2025-06-30");
    expect(out.result.matched).toHaveLength(1);
    expect(out.result.voided).toHaveLength(1);
    expect(out.result.unmatchedClears.map((c) => c.referenceNumber)).toEqual(["99999"]);
    const refs = out.outstanding.map((o) => o.referenceNumber ?? "(none)").sort();
    expect(refs).toEqual(["(none)", "10482", "10484"]);
    const featured = out.outstanding.find((o) => o.referenceNumber === "10482")!;
    expect(featured.payeeId).toBeTruthy();
    expect(featured.ageDays).toBe(455);
    expect(featured).not.toHaveProperty("kind");

    const stored = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(stored.find((i) => i.referenceNumber === "10483")!.status).toBe("cleared");
    expect(stored.find((i) => i.referenceNumber === "10482")!.status).toBe("outstanding");
    const clears = await t.db.select().from(bankClears).where(eq(bankClears.companyId, companyId));
    expect(clears.find((c) => c.referenceNumber === "10483")!.ledgerItemId).toBe(
      stored.find((i) => i.referenceNumber === "10483")!.id,
    );
  });

  it("reopens items when a later run no longer matches, and persist:false writes nothing", async () => {
    const companyId = await newCompany();
    await insertLedgerRows(t.db, companyId, [row({ number: "1", issueDate: "2025-01-01", amount: 100 })]);
    await insertClearRows(t.db, companyId, [{ checkNumber: "1", amount: 100, clearedDate: "2025-03-01" }]);
    await runReconciliation(t.db, companyId, "2025-06-30", { persist: false });
    expect((await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId)))[0]!.status).toBe("outstanding");
    await runReconciliation(t.db, companyId, "2025-06-30");
    expect((await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId)))[0]!.status).toBe("cleared");
    // as-of before the clear: the check is outstanding again
    const out = await runReconciliation(t.db, companyId, "2025-02-01");
    expect(out.outstanding).toHaveLength(1);
    expect((await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId)))[0]!.status).toBe("outstanding");
  });
});

describe("ingestCsv", () => {
  const LEDGER = [
    "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo",
    "check,1,Bayline Electric,,,CA,,100.00,2024-01-01,false,",
    "check,2,BAYLINE ELECTRIC INC,,,CA,,200.00,2024-01-02,false,",
    "check,3,Broken,,,,,notmoney,2024-01-02,false,",
  ].join("\n");

  it("returns needsMapping with suggestions when no mapping is supplied", async () => {
    const companyId = await newCompany();
    const out = await ingestCsv(t.db, { kind: "ledger", csv: "Chk No,Vendor,Amount,Date Issued\n1,A,1,1/1/24", companyId });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      needsMapping: true,
      headers: ["Chk No", "Vendor", "Amount", "Date Issued"],
      suggested: { columns: { number: "Chk No", payeeName: "Vendor" } },
    });
  });

  it("parses, persists valid rows, links payees and reports row errors", async () => {
    const companyId = await newCompany();
    const out = await ingestCsv(t.db, { kind: "ledger", csv: LEDGER, mapping: syntheticLedgerMapping, companyId });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ inserted: 2, skipped: 0, payeesLinked: 2 });
    expect((out.body as { errors: unknown[] }).errors).toHaveLength(1);
    expect(await t.db.select().from(payees).where(eq(payees.companyId, companyId))).toHaveLength(1);
  });

  it("ingests clears", async () => {
    const companyId = await newCompany();
    const out = await ingestCsv(t.db, {
      kind: "clears",
      csv: "check_number,amount,cleared_date,description\n1,100.00,2024-02-01,x",
      mapping: syntheticClearsMapping,
      companyId,
    });
    expect(out.body).toMatchObject({ inserted: 1, errors: [] });
  });

  it("404 for an unknown company; 422 for header mismatch or all-bad rows", async () => {
    const companyId = await newCompany();
    expect((await ingestCsv(t.db, { kind: "ledger", csv: LEDGER, mapping: syntheticLedgerMapping, companyId: crypto.randomUUID() })).status).toBe(404);
    const hdr = await ingestCsv(t.db, { kind: "ledger", csv: "a,b\n1,2", mapping: syntheticLedgerMapping, companyId });
    expect(hdr.status).toBe(422);
    expect(hdr.body).toHaveProperty("headerErrors");
    const bad = await ingestCsv(t.db, {
      kind: "clears",
      csv: "check_number,amount,cleared_date,description\n1,zzz,2024-02-01,x",
      mapping: syntheticClearsMapping,
      companyId,
    });
    expect(bad.status).toBe(422);
  });
});
