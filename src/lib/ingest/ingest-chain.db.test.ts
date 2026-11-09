/**
 * R11-07: a CSV import (POST /api/ingest, from Settings or Ask) appends exactly one audit-chain event in the same
 * transaction as its rows; a dry-run preview writes nothing; a re-import that adds nothing appends nothing; the chain
 * verifies.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { auditChain, bankClears, companies, ledgerItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { verifyChain } from "@/lib/audit/chain-db";
import { sha256Hex } from "@/lib/crypto";
import { ingestCsv } from "./ingest";
import { syntheticClearsMapping, syntheticLedgerMapping } from "./csv";

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
  const [c] = await t.db.insert(companies).values({ name: "Chain Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterEach(async () => {
  await t.close();
});

const H = "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo";
const CSV = `${H}\nvendor_check,99005,Old Payee LLC,1 Main St,Austin,TX,78701,500.00,2022-03-01,false,old\nvendor_check,99006,Other Payee,2 Main St,Austin,TX,78701,733.10,2023-10-12,false,`;
const ingestKinds = async () =>
  (await t.db.select().from(auditChain).where(eq(auditChain.companyId, companyId))).filter((r) => r.kind.startsWith("ingestion."));

describe("R11-07 CSV imports join the audit chain", () => {
  it("an import appends exactly one ingestion.ledger event with rows, total, file digest and source", async () => {
    const out = await ingestCsv(t.db, { kind: "ledger", csv: CSV, mapping: syntheticLedgerMapping, companyId }, { classify });
    expect(out.status).toBe(200);
    const events = await ingestKinds();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("ingestion.ledger");
    expect(JSON.parse(events[0]!.payload)).toMatchObject({ source: "csv", rows: 2, skipped: 0, totalCents: 123310, fileSha256: sha256Hex(CSV) });
    expect(JSON.parse(events[0]!.payload).rowsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });

  it("a preview writes no rows and no chain event", async () => {
    const out = await ingestCsv(t.db, { kind: "ledger", csv: CSV, mapping: syntheticLedgerMapping, companyId, preview: true }, { classify });
    expect(out.status).toBe(200);
    expect(await ingestKinds()).toHaveLength(0);
    expect(await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId))).toHaveLength(0);
  });

  it("a re-import that adds nothing appends nothing", async () => {
    await ingestCsv(t.db, { kind: "ledger", csv: CSV, mapping: syntheticLedgerMapping, companyId }, { classify });
    await ingestCsv(t.db, { kind: "ledger", csv: CSV, mapping: syntheticLedgerMapping, companyId }, { classify });
    expect(await ingestKinds()).toHaveLength(1);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });

  it("a bank-clears import appends one ingestion.bank event", async () => {
    const csv = "check_number,amount,cleared_date,description\n99005,500.00,2022-04-01,cleared";
    const out = await ingestCsv(t.db, { kind: "clears", csv, mapping: syntheticClearsMapping, companyId }, { classify });
    expect(out.status).toBe(200);
    expect(await t.db.select().from(bankClears).where(eq(bankClears.companyId, companyId))).toHaveLength(1);
    const events = await ingestKinds();
    expect(events.map((e) => e.kind)).toEqual(["ingestion.bank"]);
    expect(JSON.parse(events[0]!.payload)).toMatchObject({ rows: 1, totalCents: 50000, fileSha256: sha256Hex(csv) });
  });
});
