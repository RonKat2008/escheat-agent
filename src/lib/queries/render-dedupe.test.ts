/**
 * docs/perf/2026-11-04-navigation.md: loadOpenRows, getOverdue (company-wide), loadForecastInputs and the shell reads
 * (demo-clock offset behind now()/today(), getDefaultCompanyId, getCompany, waitingBreakdown, company-wide getExposure)
 * are wrapped in React cache() so one server render reads them once. Outside a render (actions, route handlers, chat tools, these
 * tests) they must stay plain calls: a demo-clock change or a status change is visible to the very next call.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { staleItems } from "@/db/schema";
import { countWaiting, waitingBreakdown } from "@/app/(app)/approvals/queue-count";
import { advanceClock, getOffsetDays, now, resetClock } from "@/lib/clock";
import { addDays } from "@/lib/dates";
import { getCompany, getDefaultCompanyId, today } from "./common";
import { getExposure } from "./exposure";
import { getCalendarExtras, getForecast, loadForecastInputs } from "./forecast";
import { loadOpenRows } from "./items";
import { getOverdue } from "./overdue";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

let t: TestDb;
let companyId: string;
let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
const prevAnchor = process.env.DEMO_ANCHOR_DATE;

beforeAll(() => {
  process.env.DEMO_ANCHOR_DATE = "2026-11-01";
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});
beforeEach(async () => {
  t = await createTestDb();
  ({ companyId, ids } = await insertFixture(t.db, STANDARD_ITEMS));
});
afterEach(async () => {
  await t.close();
});

describe("per-render dedupe never caches across calls outside a render", () => {
  it("getOverdue sees a demo-clock change on the next call", async () => {
    const before = await getOverdue(t.db, companyId);
    await advanceClock(t.db, companyId, 400);
    const after = await getOverdue(t.db, companyId);
    expect(after.asOf).not.toBe(before.asOf);
    expect(after.count).toBeGreaterThan(before.count);
  });

  it("loadOpenRows drops an item resolved between two calls", async () => {
    const before = await loadOpenRows(t.db, companyId);
    const first = Object.values(ids).find((v) => before.some((r) => r.id === v.staleId))!;
    await t.db.update(staleItems).set({ status: "resolved_paid" }).where(eq(staleItems.id, first.staleId));
    const after = await loadOpenRows(t.db, companyId);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((r) => r.id === first.staleId)).toBe(false);
  });

  it("loadForecastInputs follows status changes between calls", async () => {
    const before = await loadForecastInputs(t.db, companyId);
    const victim = before[0]!;
    await t.db.update(staleItems).set({ status: "resolved_paid" }).where(eq(staleItems.id, victim.itemId));
    const after = await loadForecastInputs(t.db, companyId);
    expect(after.some((i) => i.itemId === victim.itemId)).toBe(false);
  });
});

describe("shell reads (demo clock, company id, waiting count) stay live outside a render", () => {
  it("today() and now() see a demo-clock move on the very next call", async () => {
    const before = await today(t.db, companyId);
    expect(await now(t.db, companyId)).toBe(before);
    await advanceClock(t.db, companyId, 3);
    expect(await today(t.db, companyId)).toBe(addDays(before, 3));
    expect(await now(t.db, companyId)).toBe(addDays(before, 3));
    await resetClock(t.db, companyId);
    expect(await today(t.db, companyId)).toBe(before);
  });

  it("advanceClock builds on the offset just written, not a remembered one", async () => {
    expect(await advanceClock(t.db, companyId, 2)).toBe(2);
    expect(await advanceClock(t.db, companyId, 5)).toBe(7);
    expect(await getOffsetDays(t.db, companyId)).toBe(7);
  });

  it("waitingBreakdown and countWaiting count an owner reply made between two calls", async () => {
    const before = await waitingBreakdown(t.db, companyId);
    const waitingBefore = await countWaiting(t.db, companyId);
    expect(waitingBefore).toBe(before.total);
    await t.db.update(staleItems).set({ status: "owner_responded" }).where(eq(staleItems.id, ids.a!.staleId));
    const after = await waitingBreakdown(t.db, companyId);
    expect(after.ownerTasks.count).toBe(before.ownerTasks.count + 1);
    expect(await countWaiting(t.db, companyId)).toBe(waitingBefore + 1);
  });

  it("getDefaultCompanyId and getCompany return the seeded company", async () => {
    expect(await getDefaultCompanyId(t.db)).toBe(companyId);
    expect((await getCompany(t.db, companyId)).id).toBe(companyId);
  });

  it("company-wide getExposure drops an item resolved between two calls; scoped calls match it", async () => {
    const before = await getExposure(t.db, companyId);
    await t.db.update(staleItems).set({ status: "resolved_paid" }).where(eq(staleItems.id, ids.a!.staleId));
    const after = await getExposure(t.db, companyId);
    expect(after.itemCount).toBe(before.itemCount - 1);
    expect(after.totalCents).toBe(before.totalCents - 234000);
    const ca = await getExposure(t.db, companyId, { state: "ca" });
    expect(ca.totalCents).toBe(after.byState.find((s) => s.state === "CA")?.cents ?? 0);
    expect((await getExposure(t.db, companyId, { includeFiled: true })).itemCount).toBeGreaterThanOrEqual(after.itemCount);
  });
});

describe("getOverdue state scope", () => {
  it("a state-scoped summary is the company-wide one filtered to that state", async () => {
    await advanceClock(t.db, companyId, 400);
    const all = await getOverdue(t.db, companyId);
    for (const state of new Set(all.items.map((i) => i.state).filter((s): s is string => s !== null))) {
      const scoped = await getOverdue(t.db, companyId, { states: [state.toLowerCase()] });
      expect(scoped.items.map((i) => i.itemId)).toEqual(all.items.filter((i) => i.state === state).map((i) => i.itemId));
      expect(scoped.asOf).toBe(all.asOf);
    }
    // An empty scope list means company-wide, same as no option.
    expect((await getOverdue(t.db, companyId, { states: [] })).items).toEqual(all.items);
  });
});

describe("forecast and calendar share one engine pass", () => {
  it("both read models still agree with their inputs", async () => {
    const inputs = await loadForecastInputs(t.db, companyId);
    const [forecast, extras] = await Promise.all([getForecast(t.db, companyId), getCalendarExtras(t.db, companyId)]);
    expect(inputs.length).toBeGreaterThan(0);
    expect(forecast.asOf).toBe("2026-11-01");
    const known = new Set(inputs.map((i) => i.itemId));
    for (const e of extras) {
      if ("itemId" in e && typeof e.itemId === "string") expect(known.has(e.itemId)).toBe(true);
    }
  });
});
