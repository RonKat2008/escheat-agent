/**
 * R9-03 on the seeded demo DB after a +45-day clock move: items owed to states with no rules file (FL, IL, NY, OR)
 * are detected and stay in the total, and every surface's query reports the SAME not-covered count and amount.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { resetClock } from "@/lib/clock";
import { executeChatTool } from "@/lib/chat/tools";
import { loadCfoBrief } from "@/lib/cfo-brief/data";
import { inScopeStates } from "@/lib/coverage-server";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { getExposure, getForecast } from "@/lib/queries";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { syncRulesToDb } from "@/lib/rules/load";
import { buildBundle } from "@/lib/synthetic/build";
import { DEMO_ANCHOR_DATE } from "@/lib/synthetic/model";
import { seedDemo } from "@/lib/synthetic/seed";

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
}, 120_000);
afterAll(async () => {
  await t?.close();
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
});

describe("fresh seed", () => {
  it("has nothing outside the states with rules", async () => {
    const e = await getExposure(t.db, companyId);
    expect(e.coverage.notCovered.count).toBe(0);
    expect(e.coverage.inScope.cents).toBe(e.totalCents);
  });
});

describe("after +45 days", () => {
  let exp: Awaited<ReturnType<typeof getExposure>>;
  beforeAll(async () => {
    await moveDemoClock(t.db, companyId, 45);
    exp = await getExposure(t.db, companyId);
  }, 120_000);

  it("keeps the not-covered money in the total and splits it from the states with rules", () => {
    const nc = exp.coverage.notCovered;
    expect(nc.count).toBeGreaterThan(0);
    expect(nc.states.every((s) => !inScopeStates().includes(s))).toBe(true);
    expect(exp.coverage.inScope.cents + nc.cents).toBe(exp.totalCents);
    expect(exp.coverage.inScope.count + nc.count).toBe(exp.itemCount);
    expect(nc.byState.reduce((a, s) => a + s.cents, 0)).toBe(nc.cents);
  });

  it("chat get_exposure returns an explicit notCovered breakdown with the same figures", async () => {
    const r = await executeChatTool("get_exposure", {}, { db: t.db, companyId });
    if (!r.ok) throw new Error(r.error);
    const data = r.data as { notCovered: { total: string; count: number; states: string[]; note: string }; inScope: { total: string } };
    expect(data.notCovered.count).toBe(exp.coverage.notCovered.count);
    expect(data.notCovered.total).toBe(exp.coverage.notCovered.formatted);
    expect(data.notCovered.states).toEqual(exp.coverage.notCovered.states);
    expect(data.notCovered.note).toMatch(/no legal dates/);
    expect(data.inScope.total).toBe(exp.coverage.inScope.formatted);
  });

  it("the ledger keeps their payable and reports the same not-covered count and amount", async () => {
    const view = computeLedger(await loadLedger(t.db, companyId), "fy");
    expect(view.notCovered.count).toBe(exp.coverage.notCovered.count);
    expect(view.notCovered.cents).toBe(exp.coverage.notCovered.cents);
    expect(view.roll.total.closing).toBeGreaterThanOrEqual(exp.totalCents);
    expect(view.roll.total.reconciles && view.roll.states.every((s) => s.reconciles)).toBe(true);
    expect(view.ruleStates).toEqual(inScopeStates());
  });

  it("the forecast never offers a state without rules or places its money in a month", async () => {
    const f = await getForecast(t.db, companyId, { horizonMonths: 12 });
    const covered = new Set(inScopeStates());
    for (const m of f.months) {
      for (const c of m.byState) {
        if (!covered.has(c.state)) expect([c.presumedCents, c.remitCents, c.presumedCount, c.remitCount]).toEqual([0, 0, 0, 0]);
      }
    }
    expect(f.states.filter((s) => covered.has(s)).length).toBeGreaterThan(0);
    const nc = new Set(exp.coverage.notCovered.states);
    for (const m of f.months) for (const e of m.events) expect(nc.has(e.state)).toBe(false);
  });

  it("the CFO brief carries the same not-covered line data and keeps the total", async () => {
    const brief = await loadCfoBrief(t.db, companyId, { generatedAt: new Date("2026-12-16T12:00:00Z") });
    expect(brief.headline.cents).toBe(exp.totalCents);
    expect(brief.headline.notCovered.count).toBe(exp.coverage.notCovered.count);
    expect(brief.headline.notCovered.cents).toBe(exp.coverage.notCovered.cents);
    expect(brief.headline.inScopeStates).toEqual(exp.coverage.inScope.states);
  });
});
