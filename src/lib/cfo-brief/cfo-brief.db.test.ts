/**
 * The CFO brief against the real SYNTHETIC demo seed: every number equals the query the matching page reads
 * (dashboard exposure + late money, /ledger FY closing, /forecast 6-month presumed total, approvals queue,
 * recoveries), and the one-page PDF's text layer carries them plus the disclaimer and rule versions.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createTestDb, type TestDb } from "@/db/client";
import { waitingBreakdown } from "@/app/(app)/approvals/queue-count";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { resetClock } from "@/lib/clock";
import { formatUSD } from "@/lib/money";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { getExposure, getForecast, getOpenCounts, getOverdue } from "@/lib/queries";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { pdfPageTexts } from "@/lib/reports/__fixtures__/pdf";
import { summarizeLateMoney } from "@/lib/reports/late-money";
import { syncRulesToDb, tryLoadRules } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";
import { loadCfoBrief, type CfoBriefData } from "./data";
import { buildCfoBrief, CFO_BRIEF_DISCLAIMER, stampUtc } from "./pdf";

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));
const GENERATED = new Date("2026-11-04T17:03:09Z");

let t: TestDb;
let companyId: string;
let prevAnchor: string | undefined;
let brief: CfoBriefData;

beforeAll(async () => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = DEMO_ANCHOR_DATE;
  t = await createTestDb();
  const bundle = buildBundle();
  await seedDemo(t.db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  await syncRulesToDb(t.db);
  companyId = (await resolveCompanyId(t.db))!;
  await resetClock(t.db, companyId);
  await detectStaleItems(t.db, companyId, { classify });
  brief = await loadCfoBrief(t.db, companyId, { generatedAt: GENERATED });
}, 120_000);
afterAll(async () => {
  await t?.close();
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});

describe("loadCfoBrief on the seeded demo DB", () => {
  it("headline equals the dashboard hero (getExposure total, open-unreported count, states)", async () => {
    const [exp, open] = await Promise.all([getExposure(t.db, companyId), getOpenCounts(t.db, companyId)]);
    expect(brief.headline.cents).toBe(exp.totalCents);
    expect(brief.headline.cents).toBe(6_191_500);
    expect(brief.headline.count).toBe(open.unreported.count);
    expect(brief.headline.states).toEqual(exp.byState.map((s) => s.state));
    expect(brief.asOf).toBe(exp.asOf);
  });

  it("per-state rows sum to the headline for CA/DE/TX and carry the rule file version", async () => {
    const exp = await getExposure(t.db, companyId);
    expect(brief.states.map((s) => s.state)).toEqual(["CA", "DE", "TX"]);
    for (const s of brief.states) {
      const e = exp.byState.find((x) => x.state === s.state);
      expect(s.cents).toBe(e?.cents ?? 0);
      expect(s.count).toBe(e?.count ?? 0);
      expect(s.ruleVersion).toBe(tryLoadRules(s.state)?.file.version ?? null);
      if (s.nextDeadline) expect(s.nextDeadline.daysLeft).toBeGreaterThanOrEqual(0);
    }
    expect(brief.states.map((s) => s.count)).toEqual([21, 11, 15]);
  });

  it("late money and interest equal the dashboard's summarizeLateMoney call", async () => {
    const o = await getOverdue(t.db, companyId);
    const late = summarizeLateMoney(o.items, (s) => tryLoadRules(s)?.file ?? null, o.asOf);
    expect(brief.late.lateCents).toBe(late.lateCents);
    expect(brief.late.lateCount).toBe(late.lateCount);
    expect(brief.late.interestCents).toBe(late.interestCents);
    expect(brief.late.interestVerified).toBe(late.interestVerified);
    expect(brief.overdue.cents).toBe(o.total.cents);
  });

  it("waiting, ledger closing and forecast equal their pages' queries", async () => {
    const [w, l, f] = await Promise.all([waitingBreakdown(t.db, companyId), loadLedger(t.db, companyId), getForecast(t.db, companyId, { horizonMonths: 6 })]);
    expect(brief.waiting).toEqual(w);
    const fy = computeLedger(l, "fy");
    expect(brief.ledger.closingCents).toBe(fy.roll.total.closing);
    expect(brief.ledger.periodStart).toBe(fy.roll.period.start);
    expect(brief.forecast.months).toHaveLength(6);
    expect(brief.forecast.totalCents).toBe(f.totals.presumedCents);
  });

  it("recoveries are empty on a fresh seed (nothing searched yet)", () => {
    expect(brief.recoveries).toEqual({ foundCount: 0, foundCents: 0, paidCount: 0, paidCents: 0 });
  });
});

describe("buildCfoBrief PDF", () => {
  it("is exactly one page whose text carries the key figures, disclaimer, stamp and rule versions", async () => {
    const bytes = await buildCfoBrief(brief);
    // Opt-in local preview of the seeded brief (never in CI): CFO_BRIEF_OUT=/abs/path.pdf pnpm exec vitest run src/lib/cfo-brief
    if (process.env.CFO_BRIEF_OUT) writeFileSync(process.env.CFO_BRIEF_OUT, bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const [text] = await pdfPageTexts(bytes);
    expect(text).toContain("$61,915.00");
    expect(text).toContain(formatUSD(brief.ledger.closingCents));
    expect(text).toContain(CFO_BRIEF_DISCLAIMER);
    expect(text).toContain("Synthetic data");
    expect(text).toContain(`Generated ${stampUtc(GENERATED.toISOString())}`);
    expect(text).toContain("Demo date Nov 1, 2026");
    for (const r of brief.ruleVersions) expect(text).toContain(`${r.state} ${r.version}`);
    if (brief.states.some((s) => s.unverified)) expect(text).toContain("UNVERIFIED");
    if (brief.late.lateCount > 0) expect(text).toContain(formatUSD(brief.late.lateCents));
    expect(text).toContain(`${brief.waiting.total}\n items waiting on a person`);
    const de = brief.states.find((s) => s.state === "DE")!;
    if (!de.nextDeadline && de.datesUnknown > 0) expect(text).toContain(`Date unknown for ${de.datesUnknown} item`);
  });

  it("names unknown interest instead of estimating, and a quiet state stays quiet", async () => {
    const quiet: CfoBriefData = {
      ...brief,
      late: { lateCount: 2, lateCents: 5000, interestCents: null, interestVerified: false, interestStates: [], unknownInterestStates: ["NY"] },
      states: brief.states.map((s) => ({ ...s, nextDeadline: null, datesUnknown: 0 })),
    };
    const [text] = await pdfPageTexts(await buildCfoBrief(quiet));
    expect(text).toContain("Audit interest accruing: unknown.");
    expect(text).toContain("NY has no usable interest rule");
    expect(text).toContain("None scheduled");
    const none = await pdfPageTexts(await buildCfoBrief({ ...brief, late: { ...quiet.late, lateCount: 0, lateCents: 0, unknownInterestStates: [] } }));
    expect(none[0]).toContain("Nothing is past a report");
  });
});
