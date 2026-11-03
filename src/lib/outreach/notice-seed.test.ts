/**
 * One notice per owner against the real SYNTHETIC demo seed: the 0007 migration adds outreach_items without touching
 * the seeded numbers (47 items, $61,915.00; CA 21, TX 15, DE 11), and merging the Bayline duplicates then composing
 * all yields one Bayline letter for both checks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { ledgerItems, outreach, outreachItems, payees, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { resetClock } from "@/lib/clock";
import { composeLetter } from "@/lib/letters/compose";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { applyPayeeChange, previewPayeeChange } from "@/lib/payees/review";
import { syncRulesToDb } from "@/lib/rules/load";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { buildBundle } from "@/lib/synthetic/build";
import { seedDemo } from "@/lib/synthetic/seed";
import { composeAllDrafts } from "./bulk";
import { testEnv } from "./testing";

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));
const failing = async () => {
  throw new AnthropicNotConfigured();
};

let t: TestDb;
let companyId: string;
let prevAnchor: string | undefined;
let detected: Awaited<ReturnType<typeof detectStaleItems>>;

beforeAll(async () => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = DEMO_ANCHOR_DATE;
  t = await createTestDb();
  const bundle = buildBundle();
  await seedDemo(t.db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  await syncRulesToDb(t.db);
  companyId = (await resolveCompanyId(t.db))!;
  await resetClock(t.db, companyId);
  detected = await detectStaleItems(t.db, companyId, { classify });
});
afterAll(async () => {
  await t.close();
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});

describe("migration 0007 + demo seed invariants", () => {
  it("creates outreach_items with its unique (outreach, item) key", async () => {
    const res = await t.db.execute(sql`select indexname from pg_indexes where tablename = 'outreach_items' order by indexname`);
    const names = (res as unknown as { rows: { indexname: string }[] }).rows.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining(["outreach_items_outreach_item_uq", "outreach_items_stale_item_idx"]));
  });

  it("keeps the seeded numbers: 47 items, $61,915.00, CA 21 / TX 15 / DE 11, and no notice rows", async () => {
    expect(detected.inserted + detected.updated).toBe(47);
    expect(detected.totalCents).toBe(6_191_500);
    expect(detected.byState).toMatchObject({ CA: 21, TX: 15, DE: 11 });
    const [{ n }] = (await t.db.select({ n: count() }).from(outreachItems)) as [{ n: number }];
    expect(n).toBe(0);
  });

  it("after the Bayline merge, compose all yields one Bayline letter for both checks ($6,126.71)", async () => {
    const bay = await t.db
      .select({ s: staleItems, l: ledgerItems })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .where(sql`${ledgerItems.payeeNameRaw} ilike 'bayline%'`);
    expect(bay.map((b) => b.l.referenceNumber).sort()).toEqual(["10482", "10537"]);
    expect(new Set(bay.map((b) => b.s.ownerPayeeId)).size).toBe(2);

    const keep = bay.find((b) => b.l.referenceNumber === "10482")!.s.ownerPayeeId!;
    const merge = bay.find((b) => b.l.referenceNumber === "10537")!.s.ownerPayeeId!;
    const change = { kind: "merge" as const, keepId: keep, mergeId: merge };
    const preview = await previewPayeeChange(t.db, companyId, change);
    await applyPayeeChange(t.db, companyId, { change, by: "Dana (test)", fingerprint: preview.fingerprint });
    const [kept] = await t.db.select().from(payees).where(eq(payees.id, keep));
    expect(kept!.canonicalName).toBe("Bayline Electric");

    const deps = { env: testEnv(), draftVariables: failing };
    for (const b of bay) await composeLetter(t.db, b.s.id, deps);
    const { results } = await composeAllDrafts(t.db, { companyId, channel: "letter" }, deps);
    const bayline = results.find((r) => r.status === "composed" && r.itemCount === 2);
    expect(bayline).toBeDefined();
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, bayline!.outreachId));
    expect(row!.body).toContain("#10482");
    expect(row!.body).toContain("#10537");
    expect(row!.body).toContain("$6,126.71");
    const open = await t.db.select().from(outreach).where(eq(outreach.status, "draft"));
    expect(open.filter((o) => bay.some((b) => b.s.id === o.staleItemId))).toHaveLength(1);
  });
});
