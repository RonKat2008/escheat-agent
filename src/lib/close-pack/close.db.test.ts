/**
 * R10-01 against the SYNTHETIC demo seed: closing Nov 2026 freezes the journal and the pack, records the manifest hash in
 * the audit chain, survives a +45 day clock move byte-for-byte, and refuses a re-close. The close goes through the
 * server-enforced close_period approval.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { ReviewedContentChangedError } from "@/lib/approvals";
import { loadChain, verifyChain } from "@/lib/audit/chain-db";
import { resetClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { syncRulesToDb } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";
import { CloseError, closePeriod, closePreviews, listClosedPeriods, loadClosedPack } from "./close";

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
let prevAnchor: string | undefined;
let prevDemo: string | undefined;

beforeAll(async () => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  prevDemo = process.env.DEMO_MODE;
  process.env.DEMO_ANCHOR_DATE = DEMO_ANCHOR_DATE;
  process.env.DEMO_MODE = "1";
  t = await createTestDb();
  const bundle = buildBundle();
  await seedDemo(t.db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  await syncRulesToDb(t.db);
  companyId = (await resolveCompanyId(t.db))!;
  await resetClock(t.db, companyId);
  await detectStaleItems(t.db, companyId, { classify });
}, 180_000);

afterAll(async () => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
  await t?.close?.();
});

describe("close a month", () => {
  it("refuses a blank approver, a stale review and a repeat close; freezes, chains and stays byte-identical after +45 days", async () => {
    const before = closePreviews(await loadLedger(t.db, companyId), ["2026-11"])["2026-11"]!;
    expect(before.entryCount).toBeGreaterThan(0);

    await expect(closePeriod(t.db, { companyId, period: "2026-11", approvedBy: " ", expectedJournalSha256: before.journalSha256 })).rejects.toMatchObject({ code: "no_approver" });
    await expect(closePeriod(t.db, { companyId, period: "2026-11", approvedBy: "Dana Reviewer", expectedJournalSha256: "0".repeat(64) })).rejects.toBeInstanceOf(ReviewedContentChangedError);
    expect(await loadClosedPack(t.db, companyId, "2026-11")).toBeNull();
    expect(await t.db.select().from(approvals)).toHaveLength(0);

    const closed = await closePeriod(t.db, { companyId, period: "2026-11", approvedBy: "Dana Reviewer", expectedJournalSha256: before.journalSha256 });
    expect(closed).toMatchObject({ period: "2026-11", entryCount: before.entryCount, closedBy: "Dana Reviewer" });

    // approval granted + consumed, then the period.closed event carrying the manifest hash
    const chain = await loadChain(t.db, companyId);
    const ev = chain.find((r) => r.kind === "period.closed")!;
    expect(ev.seq).toBe(closed.chainSeq);
    expect(JSON.parse(ev.payload)).toMatchObject({ period: "2026-11", manifestSha256: closed.manifestSha256, journalSha256: before.journalSha256 });
    expect(chain.some((r) => r.kind === "approval.granted" && JSON.parse(r.payload).action === "close_period")).toBe(true);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);

    const first = (await loadClosedPack(t.db, companyId, "2026-11"))!;
    expect(sha256Hex(first.zip)).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifestSha256).toBe(closed.manifestSha256);
    expect((await listClosedPeriods(t.db, companyId)).map((c) => c.period)).toEqual(["2026-11"]);

    await expect(closePeriod(t.db, { companyId, period: "2026-11", approvedBy: "Dana Reviewer", expectedJournalSha256: before.journalSha256 })).rejects.toBeInstanceOf(CloseError);

    // The clock moves 45 days: items are detected later, some dated inside November.
    const journalNov = computeLedger(await loadLedger(t.db, companyId), "month", { id: "month", label: "Nov 2026", start: "2026-11-01", end: "2026-11-30" }).journal.entries;
    await moveDemoClock(t.db, companyId, 45);
    const second = (await loadClosedPack(t.db, companyId, "2026-11"))!;
    expect(sha256Hex(second.zip)).toBe(sha256Hex(first.zip));
    expect(Buffer.from(second.zip).equals(Buffer.from(first.zip))).toBe(true);

    const data = await loadLedger(t.db, companyId);
    const nov = computeLedger(data, "month", { id: "month", label: "Nov 2026", start: "2026-11-01", end: "2026-11-30" }).journal.entries;
    const covered = (await loadLedger(t.db, companyId)).closes![0]!.entries;
    expect(nov).toEqual(covered);
    expect(journalNov.length).toBeGreaterThan(0);
    // anything dated on or before November that arrived after the close (R11-01: any month inside the closed books, not
    // only November) is a prior-period adjustment posted on Dec 1
    const dec = computeLedger(data, "month", { id: "month", label: "Dec 2026", start: "2026-12-01", end: "2026-12-31" }).journal.entries;
    for (const e of dec.filter((x) => x.priorPeriodOf)) {
      expect(e.priorPeriodOf! <= "2026-11").toBe(true);
      expect(e.date).toBe("2026-12-01");
      expect(e.je).toContain("-PPA-");
    }
  }, 180_000);

  it("the closed month cannot be changed or deleted, even by raw SQL", async () => {
    const fail = (q: ReturnType<typeof sql>) =>
      t.db.execute(q).then(
        () => null,
        (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? String(e),
      );
    expect(await fail(sql`UPDATE period_closes SET closed_by = 'x'`)).toMatch(/append-only/);
    expect(await fail(sql`DELETE FROM period_closes`)).toMatch(/append-only/);
  });

  it("the demo reset still clears the chain and the closes", async () => {
    const bundle = buildBundle();
    await seedDemo(t.db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
    const rows = (await t.db.execute(sql`SELECT (SELECT count(*) FROM audit_chain WHERE kind IN ('period.closed','approval.granted','clock.move'))::int AS a, (SELECT count(*) FROM period_closes)::int AS p`)) as unknown as { rows?: { a: number; p: number }[] } | { a: number; p: number }[];
    const r = Array.isArray(rows) ? rows[0]! : rows.rows![0]!;
    expect(r.a).toBe(0);
    expect(r.p).toBe(0);
  }, 120_000);
});
