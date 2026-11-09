import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { interpretIngestResponse, interpretPreviewResponse } from "@/lib/integrations/csv-upload";
import { IngestRequestSchema, ingestCsv, PREVIEW_SAMPLE_ROWS } from "./ingest";
import type { ColumnMapping } from "./mapping";

/** The Ask upload card's synthetic sample (fixtures/synthetic/README.md): 6 rows, 2 deliberately bad. */
const SAMPLE = readFileSync(join(process.cwd(), "fixtures/synthetic/ask-upload-sample.csv"), "utf8");

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
  const [c] = await t.db.insert(companies).values({ name: "Test Co (SYNTHETIC)", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterEach(async () => {
  await t.close();
});

const rows = async () => Number((await t.db.select({ n: count() }).from(ledgerItems).where(eq(ledgerItems.companyId, companyId)))[0]?.n ?? 0);

/** The card's flow: read columns (suggested mapping), preview (dry run), then import. */
async function suggested(): Promise<ColumnMapping> {
  const out = await ingestCsv(t.db, { kind: "ledger", csv: SAMPLE, companyId });
  const view = interpretIngestResponse(out.status, out.body);
  if (view.type !== "needsMapping") throw new Error(`expected a mapping step, got ${view.type}`);
  return view.suggested;
}

describe("ingest dry-run preview (Ask upload card)", () => {
  it("suggests a mapping for the sample's non-standard headers, leaving the extra column unmapped", async () => {
    const m = await suggested();
    expect(m.columns).toMatchObject({ number: "Chk No", payeeName: "Vendor", amount: "Amount", issueDate: "Date Issued", memo: "Notes" });
    expect(Object.values(m.columns)).not.toContain("Department");
  });

  it("previews valid rows and row-level errors with spreadsheet line numbers, and stores nothing", async () => {
    const mapping = await suggested();
    const out = await ingestCsv(t.db, { kind: "ledger", csv: SAMPLE, companyId, mapping, preview: true }, { classify });
    expect(out.status).toBe(200);
    const view = interpretPreviewResponse(out.status, out.body);
    if (view.type !== "preview") throw new Error(view.message);
    expect(view.preview.validRows).toBe(4);
    expect(view.preview.errorCount).toBe(2);
    expect(view.preview.sample).toHaveLength(Math.min(4, PREVIEW_SAMPLE_ROWS));
    expect(view.preview.sample[0]).toMatchObject({ number: "90001", payeeName: "Larkspur Tile Works", amount: "412.50", issueDate: "2025-02-14" });
    const lines = view.preview.rowErrors.map((e) => e.line).sort();
    expect(lines).toEqual([5, 6]);
    expect(view.preview.rowErrors.find((e) => e.line === 6)?.message).toMatch(/after today \(2026-11-01\)/);
    expect(await rows()).toBe(0);
  });

  it("the confirmed import stores exactly the previewed valid rows; a re-import skips them", async () => {
    const mapping = await suggested();
    const out = await ingestCsv(t.db, { kind: "ledger", csv: SAMPLE, companyId, mapping }, { classify });
    const view = interpretIngestResponse(out.status, out.body);
    expect(view).toMatchObject({ type: "done", result: { inserted: 4, skipped: 0, errorCount: 2 } });
    expect(await rows()).toBe(4);
    const again = interpretIngestResponse(200, (await ingestCsv(t.db, { kind: "ledger", csv: SAMPLE, companyId, mapping }, { classify })).body);
    expect(again).toMatchObject({ type: "done", result: { inserted: 0, skipped: 4 } });
  });

  it("a preview with a mapping that does not fit is an honest error, not an empty success", async () => {
    const out = await ingestCsv(t.db, { kind: "ledger", csv: SAMPLE, companyId, mapping: { columns: { payeeName: "Nope", amount: "Amount", issueDate: "Date Issued" } }, preview: true });
    expect(out.status).toBe(422);
    expect(interpretPreviewResponse(out.status, out.body)).toMatchObject({ type: "error", message: "Column mapping does not fit this CSV" });
  });

  it("validates the preview flag at the boundary", () => {
    expect(IngestRequestSchema.safeParse({ kind: "ledger", csv: "a", companyId, preview: "yes" }).success).toBe(false);
    expect(IngestRequestSchema.safeParse({ kind: "ledger", csv: "a", companyId, preview: true }).success).toBe(true);
  });
});

describe("interpretPreviewResponse", () => {
  it("never reports an unexpected body as a preview", () => {
    expect(interpretPreviewResponse(200, { inserted: 3 })).toMatchObject({ type: "error" });
    expect(interpretPreviewResponse(200, null)).toMatchObject({ type: "error" });
    expect(interpretPreviewResponse(500, { error: "Ingest failed" })).toEqual({ type: "error", message: "Ingest failed", details: [] });
  });
});
