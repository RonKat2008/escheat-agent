import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./client";
import { companies, ledgerItems, payees } from "./schema";

describe("createTestDb (in-memory PGlite)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("applies migrations and round-trips a company and ledger item", async () => {
    const [company] = await t.db
      .insert(companies)
      .values({ name: "Northwind Fixtures, Inc.", incorporationState: "DE", hqState: "TX" })
      .returning();
    expect(company).toBeDefined();

    const [payee] = await t.db
      .insert(payees)
      .values({ companyId: company!.id, canonicalName: "Bayline Electric", aliases: ["Bayline Elec."], state: "CA" })
      .returning();

    await t.db.insert(ledgerItems).values({
      companyId: company!.id,
      payeeId: payee!.id,
      payeeNameRaw: "Bayline Electric",
      propertyType: "vendor_check",
      referenceNumber: "10482",
      amountCents: 234_000,
      issueDate: "2025-04-15",
      state: "CA",
    });

    const rows = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, company!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      referenceNumber: "10482",
      amountCents: 234_000,
      issueDate: "2025-04-15",
      status: "outstanding",
    });
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);

    const [p] = await t.db.select().from(payees).where(eq(payees.id, payee!.id));
    expect(p?.aliases).toEqual(["Bayline Elec."]);
  });

  it("enforces foreign keys", async () => {
    await expect(
      t.db.insert(ledgerItems).values({
        companyId: "00000000-0000-0000-0000-000000000000",
        payeeNameRaw: "Ghost",
        propertyType: "vendor_check",
        amountCents: 1,
        issueDate: "2025-01-01",
      }),
    ).rejects.toThrow();
  });
});
