import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { staleItems } from "@/db/schema";
import { advanceClock } from "@/lib/clock";
import { getExposure, getOpenCounts, getStatusCounts, listStaleItems } from "./index";
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

// R4-05: the dashboard said 46 while Items said 47 once an item was reported but not yet remitted.
describe.each([0, 30, 180, 365])("open counts at clock +%i days", (offset) => {
  it("agrees with Items, the status counts and exposure, with the reported item labelled", async () => {
    await t.db.update(staleItems).set({ status: "reported" }).where(eq(staleItems.id, ids.a!.staleId));
    if (offset) await advanceClock(t.db, companyId, offset);
    const oc = await getOpenCounts(t.db, companyId);
    const items = await listStaleItems(t.db, companyId, { limit: 500 });
    const exposure = await getExposure(t.db, companyId);
    const statuses = await getStatusCounts(t.db, companyId);

    expect(oc.open.count).toBe(items.total);
    expect(oc.open.count).toBe(statuses.filter((s) => s.open).reduce((a, s) => a + s.count, 0));
    expect(oc.unreported.count).toBe(exposure.itemCount);
    expect(oc.unreported.cents).toBe(exposure.totalCents);
    expect(oc.reported).toEqual({ count: 1, cents: 234000 });
    expect(oc.open.count).toBe(oc.unreported.count + oc.reported.count);
    expect(oc.open.cents).toBe(items.items.reduce((a, r) => a + r.amount.cents, 0));
  });
});
