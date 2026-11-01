import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { ingestCsv, type IngestOutcome } from "./ingest";
import { syntheticLedgerMapping } from "./csv";

const ANCHOR = "2026-11-01";
let prevAnchor: string | undefined;
beforeAll(() => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = ANCHOR;
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterEach(async () => {
  await t.close();
});

const H = "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo";
const run = (csv: string, id = companyId): Promise<IngestOutcome> =>
  ingestCsv(t.db, { kind: "ledger", csv, mapping: syntheticLedgerMapping, companyId: id }, { classify });

describe("ingest then pipeline", () => {
  it("turns an imported stale 2022 check into a stale item and reports it", async () => {
    const out = await run(`${H}\nvendor_check,99005,Old Payee LLC,1 Main St,Austin,TX,78701,500.00,2022-03-01,false,old`);
    expect(out.status).toBe(200);
    const body = out.body as { inserted: number; pipeline: { status: string; newStale: number } };
    expect(body.inserted).toBe(1);
    expect(body.pipeline).toMatchObject({ status: "ok", newStale: 1 });
    const stale = await t.db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
    expect(stale).toHaveLength(1);
  });

  it("honestly reports zero new stale items when the rows are recent", async () => {
    const out = await run(`${H}\nvendor_check,1,Fresh Co,,,,,10.00,2026-10-01,false,`);
    const body = out.body as { pipeline: { status: string; newStale: number; notYetStale: number; thresholdDays: number } };
    expect(body.pipeline).toMatchObject({ status: "ok", newStale: 0, notYetStale: 1 });
    expect(body.pipeline.thresholdDays).toBeGreaterThan(0);
  });

  it("is scoped to the company: another company's rows are not touched", async () => {
    const [other] = await t.db.insert(companies).values({ name: "Other Co", incorporationState: "CA" }).returning();
    await t.db.insert(ledgerItems).values({
      companyId: other!.id,
      payeeNameRaw: "Elsewhere",
      propertyType: "vendor_check",
      referenceNumber: "7",
      amountCents: 1000,
      issueDate: "2021-01-01",
    });
    await run(`${H}\nvendor_check,99005,Old Payee LLC,,,TX,,500.00,2022-03-01,false,`);
    expect(await t.db.select().from(staleItems).where(eq(staleItems.companyId, other!.id))).toHaveLength(0);
  });

  it("does not run the pipeline when nothing was inserted", async () => {
    const csv = `${H}\nvendor_check,99005,Old Payee LLC,,,TX,,500.00,2022-03-01,false,`;
    await run(csv);
    const again = await run(csv);
    expect((again.body as { pipeline?: unknown }).pipeline).toBeUndefined();
  });

  it("reports a pipeline failure without failing the import", async () => {
    const out = await ingestCsv(
      t.db,
      { kind: "ledger", csv: `${H}\nvendor_check,1,A,,,,,5.00,2022-01-01,false,`, mapping: syntheticLedgerMapping, companyId },
      {
        classify: async () => {
          throw new Error("boom");
        },
      },
    );
    const body = out.body as { inserted: number; pipeline: { status: string; message: string } };
    expect(body.inserted).toBe(1);
    expect(body.pipeline.status).toBe("error");
  });
});

describe("ingest errors", () => {
  it("groups 600 identical kind errors into one group and caps the raw list", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => `weird_kind,${i},P${i},,,,,1.00,2022-01-01,false,`);
    const out = await run([H, ...rows].join("\n"));
    expect(out.status).toBe(422);
    const body = out.body as { errorCount: number; errorGroups: { count: number; message: string; lines: number[] }[]; errors: unknown[] };
    expect(body.errorCount).toBe(600);
    expect(body.errorGroups).toHaveLength(1);
    expect(body.errorGroups[0]).toMatchObject({ count: 600, message: "unknown kind 'weird_kind'" });
    expect(body.errorGroups[0]!.lines.length).toBeLessThanOrEqual(5);
    expect(body.errors.length).toBeLessThanOrEqual(100);
  });

  it("returns a CSV parse error with its line, not a mapping error", async () => {
    const out = await run(`${H}\nvendor_check,1,A,,,,,5.00,2022-01-01,false,\nvendor_check,2,"Broken,,,,,5.00,2022-01-01,false,\n`);
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ error: "CSV parse error at line 3: unclosed quote", errorType: "parse" });
    expect((out.body as { headerErrors?: unknown }).headerErrors).toBeUndefined();
  });

  it("reports a parse error at the suggest-mapping step too", async () => {
    const out = await ingestCsv(t.db, { kind: "ledger", csv: 'a,b\n1,"x\n', companyId }, { classify });
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ errorType: "parse" });
  });

  it("labels a missing column as a mapping error", async () => {
    const out = await run("kind,payee_name,amount\ncheck,A,1.00");
    expect(out.body).toMatchObject({ error: "Column mapping does not fit this CSV", errorType: "mapping" });
  });

  it("rejects future dates and negative amounts against the simulated clock", async () => {
    const out = await run(`${H}\nvendor_check,1,Future,,,,,5.00,2031-03-04,false,\nvendor_check,2,Neg,,,,,-5.00,2022-01-01,false,\nvendor_check,3,Good,,,,,5.00,2022-01-01,false,`);
    const body = out.body as { inserted: number; errorGroups: { field?: string }[]; errors: { row: number }[] };
    expect(body.inserted).toBe(1);
    expect(body.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(body.errorGroups.map((g) => g.field).sort()).toEqual(["amount", "issueDate"]);
  });
});
