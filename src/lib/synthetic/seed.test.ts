import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../db/client";
import { bankClears, companies, evalCases, ledgerItems, payees } from "../../db/schema";
import { buildBundle } from "./build";
import { seedDemo } from "./seed";

let t: TestDb;
const bundle = buildBundle();
const cases = [...bundle.generatedCases, ...bundle.adversarialCases];
const total = async (table: Parameters<TestDb["db"]["select"]>[0] extends never ? never : typeof ledgerItems | typeof payees | typeof bankClears | typeof evalCases | typeof companies) => {
  const [row] = await t.db.select({ n: count() }).from(table);
  return row?.n ?? -1;
};

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("seedDemo (in-memory PGlite)", () => {
  it("loads the expected row counts and is idempotent", async () => {
    const first = await seedDemo(t.db, bundle.dataset, cases);
    const second = await seedDemo(t.db, bundle.dataset, cases);
    expect(second).toEqual(first);
    expect(await total(companies)).toBe(1);
    expect(await total(ledgerItems)).toBe(bundle.dataset.ledger.length);
    expect(await total(bankClears)).toBe(bundle.dataset.clears.length);
    expect(await total(evalCases)).toBe(200);
    expect(await total(payees)).toBe(new Set(bundle.dataset.ledger.map((r) => r.payee_name)).size);
    expect(first.evalCases).toBe(200);
  });

  it("stores the featured item and flags voided rows", async () => {
    const [item] = await t.db.select().from(ledgerItems).where(eq(ledgerItems.referenceNumber, "10482"));
    expect(item).toMatchObject({
      payeeNameRaw: "Bayline Electric",
      amountCents: 234_000,
      issueDate: "2025-09-01",
      propertyType: "vendor_check",
      status: "outstanding",
      state: "CA",
    });
    expect(item?.payeeId).toBeTruthy();
    const voided = await t.db.select({ n: count() }).from(ledgerItems).where(eq(ledgerItems.status, "voided"));
    expect(voided[0]?.n).toBe(bundle.dataset.ledger.filter((r) => r.voided).length);
    const [co] = await t.db.select().from(companies);
    expect(co).toMatchObject({ name: "Northwind Fixtures, Inc.", incorporationState: "DE", hqState: "TX", isSynthetic: true });
    const slices = await t.db.select({ s: evalCases.slice, n: count() }).from(evalCases).groupBy(evalCases.slice);
    expect(Object.fromEntries(slices.map((x) => [x.s, x.n]))).toEqual({ generated: 160, adversarial: 40 });
  });
});
