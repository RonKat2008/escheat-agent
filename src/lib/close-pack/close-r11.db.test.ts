/**
 * R11-01 / R11-04 against the SYNTHETIC demo seed at Nov 1 2026: close Oct 2026, then import two backdated rows (the
 * dogfood repro). The closed month's figures stay what was frozen, the rows post to Nov 2026 as a labelled
 * prior-period adjustment, Nov's opening equals Oct's frozen closing and still ties, the frozen pack is byte-identical,
 * and months close in order (Sep after Oct and Dec before Nov are refused with 409).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { loadPeriodClose } from "@/lib/ask/cards/approval-data";
import type { ChatToolContext } from "@/lib/chat/tools/define";
import { resetClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { syntheticLedgerMapping } from "@/lib/ingest/csv";
import { ingestCsv } from "@/lib/ingest/ingest";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { syncRulesToDb } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";
import { CloseError, closePeriod, closePreviews, listClosedPeriods, loadClosedPack } from "./close";

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));
const H = "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo";
const BACKDATED = `${H}\nvendor_check,88001,Backdated Supply Co,1 Elm St,Fresno,CA,93701,733.10,2023-10-12,false,late import\nvendor_check,88002,Backdated Freight LLC,2 Oak St,Austin,TX,78701,615.25,2021-10-09,false,late import`;
const OCT = { id: "month" as const, label: "Oct 2026", start: "2026-10-01", end: "2026-10-31" };

let t: TestDb;
let companyId: string;
let ctx: ChatToolContext;
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
  ctx = { db: t.db, companyId } as ChatToolContext;
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

const closeMonth = async (period: string) => {
  const pv = closePreviews(await loadLedger(t.db, companyId), [period])[period];
  return closePeriod(t.db, { companyId, period, approvedBy: "Dana Reviewer", expectedJournalSha256: pv?.journalSha256 ?? "0".repeat(64) });
};

describe("a closed month stays closed (R11-01) and months close in order (R11-04)", () => {
  it("freezes Oct, posts a backdated import to Nov as a prior-period adjustment, and keeps the pack byte-identical", async () => {
    const closed = await closeMonth("2026-10");
    expect(closed.frozen).not.toBeNull();
    const frozen = closed.frozen!;
    const live = computeLedger(await loadLedger(t.db, companyId), "month", OCT).roll;
    expect(frozen.closingCents).toBe(live.total.closing);
    expect(frozen.openingCents).toBe(live.total.opening);

    const cardBefore = await loadPeriodClose(ctx, { period: "2026-10" });
    const packBefore = (await loadClosedPack(t.db, companyId, "2026-10"))!;

    const out = await ingestCsv(t.db, { kind: "ledger", csv: BACKDATED, mapping: syntheticLedgerMapping, companyId }, { classify });
    expect(out.status).toBe(200);
    expect((out.body as { pipeline: { newStale: number } }).pipeline.newStale).toBe(2);

    // Oct: every surface shows the frozen figures, labelled with who closed it and when.
    const cardAfter = await loadPeriodClose(ctx, { period: "2026-10" });
    expect(cardAfter.status).toBe("closed");
    expect(cardAfter.tieOut).toEqual(cardBefore.tieOut);
    expect(cardAfter.tieOut!.total.openingCents).toBe(frozen.openingCents);
    expect(cardAfter.tieOut!.total.closingCents).toBe(frozen.closingCents);
    expect(cardAfter.closed).toMatchObject({ closedBy: "Dana Reviewer", demoDate: "2026-11-01", frozen: true });
    expect(cardAfter.lateActivity).toEqual({ count: 2, cents: 73_310 + 61_525, postedIn: "2026-11" });
    const [summary] = await listClosedPeriods(t.db, companyId);
    expect(summary!.frozen).toEqual(frozen);
    // and the live recomputation of Oct agrees with the snapshot too: the closed books did not move
    const liveAfter = computeLedger(await loadLedger(t.db, companyId), "month", OCT).roll;
    expect(liveAfter.total.opening).toBe(frozen.openingCents);
    expect(liveAfter.total.closing).toBe(frozen.closingCents);

    // The close pack for Oct is byte-identical.
    const packAfter = (await loadClosedPack(t.db, companyId, "2026-10"))!;
    expect(Buffer.from(packAfter.zip).equals(Buffer.from(packBefore.zip))).toBe(true);
    expect(sha256Hex(packAfter.zip)).toBe(sha256Hex(packBefore.zip));

    // Nov: opening = Oct's frozen closing; the two rows are one labelled adjustment line; it still ties.
    const data = await loadLedger(t.db, companyId);
    const nov = computeLedger(data, "month");
    expect(nov.roll.period.start).toBe("2026-11-01");
    expect(nov.roll.total.opening).toBe(frozen.closingCents);
    expect(nov.roll.total.priorPeriod).toBe(134_835);
    expect(nov.roll.adjustment).toMatchObject({ count: 2, cents: 134_835, postedIn: "2026-11" });
    expect(nov.roll.total.reconciles).toBe(true);
    expect(nov.roll.states.every((s) => s.reconciles)).toBe(true);
    const ppa = nov.journal.entries.filter((e) => e.priorPeriodOf);
    expect(ppa.map((e) => e.state).sort()).toEqual(["CA", "TX"]);
    expect(ppa.every((e) => e.je.includes("-PPA-") && e.memo.startsWith("Prior-period adjustment") && e.date === "2026-11-01")).toBe(true);
    expect(nov.journal.balanced).toBe(true);

    const novCard = await loadPeriodClose(ctx, {});
    expect(novCard.period).toBe("2026-11");
    expect(novCard.blocked).toBeNull();
    expect(novCard.adjustment).toMatchObject({ count: 2, cents: 134_835 });
    expect(novCard.tieOut!.total.openingCents).toBe(frozen.closingCents);
    expect(novCard.tieOut!.allTie).toBe(true);
    expect(novCard.otherOpen).toEqual([]);
  }, 180_000);

  it("refuses Sep after Oct with 409 and explains; the card for Sep offers no close", async () => {
    const err = await closeMonth("2026-09").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloseError);
    expect(err).toMatchObject({ code: "out_of_order", status: 409 });
    expect((err as Error).message).toMatch(/inside books already closed through Oct 2026.*Nov 2026 is next/);
    const card = await loadPeriodClose(ctx, { month: "september", year: 2026 });
    expect(card.blocked).toMatch(/closed through Oct 2026/);
    expect(card.otherOpen.map((m) => m.period)).toEqual(["2026-11"]);
  }, 60_000);

  it("refuses Dec before Nov with 409 naming Nov; Nov then closes and opens at Oct's frozen closing", async () => {
    await moveDemoClock(t.db, companyId, 35);
    const err = await closeMonth("2026-12").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "out_of_order", status: 409 });
    expect((err as Error).message).toMatch(/^Close Nov 2026 first/);
    expect(closePreviews(await loadLedger(t.db, companyId), ["2026-12"])["2026-12"]!.blocked).toMatch(/^Close Nov 2026 first/);

    const oct = (await listClosedPeriods(t.db, companyId))[0]!.frozen!;
    const nov = await closeMonth("2026-11");
    expect(nov.frozen!.openingCents).toBe(oct.closingCents);
    expect(nov.frozen!.total.priorPeriod).toBe(134_835);
    expect(nov.frozen!.allTie).toBe(true);
    expect((await listClosedPeriods(t.db, companyId)).map((c) => c.period)).toEqual(["2026-10", "2026-11"]);
  }, 180_000);
});
