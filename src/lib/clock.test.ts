import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { companies } from "@/db/schema";
import { advanceClock, demoAnchor, getOffsetDays, isDemoMode, now, resetClock, simulatedToday } from "./clock";
import type { IsoDate } from "./dates";

describe("simulatedToday / env", () => {
  it("adds offset to anchor", () => {
    expect(simulatedToday("2026-11-01" as IsoDate, 0)).toBe("2026-11-01");
    expect(simulatedToday("2026-11-01" as IsoDate, 60)).toBe("2026-12-31");
    expect(simulatedToday("2026-11-01" as IsoDate, -1)).toBe("2026-10-31");
  });
  it("demo mode detection and anchor default", () => {
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ DEMO_MODE: "true" })).toBe(true);
    expect(isDemoMode({ DEMO_ANCHOR_DATE: "2026-11-01" })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "0", DEMO_ANCHOR_DATE: "2026-11-01" })).toBe(false);
    expect(demoAnchor({})).toBe("2026-11-01");
    expect(demoAnchor({ DEMO_ANCHOR_DATE: "2027-01-15" })).toBe("2027-01-15");
    expect(demoAnchor({ DEMO_ANCHOR_DATE: "garbage" })).toBe("2026-11-01");
  });
});

describe("db clock", () => {
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

  it("demo mode: anchor + offset; advance and reset", async () => {
    expect(await now(t.db, companyId, { demo: true, anchor: "2026-11-01" })).toBe("2026-11-01");
    expect(await advanceClock(t.db, companyId, 30)).toBe(30);
    expect(await advanceClock(t.db, companyId, 5)).toBe(35);
    expect(await now(t.db, companyId, { demo: true, anchor: "2026-11-01" })).toBe("2026-12-06");
    expect(await getOffsetDays(t.db, companyId)).toBe(35);
    await resetClock(t.db, companyId);
    expect(await now(t.db, companyId, { demo: true, anchor: "2026-11-01" })).toBe("2026-11-01");
  });
  it("real mode: real today + offset", async () => {
    await advanceClock(t.db, companyId, 10);
    expect(await now(t.db, companyId, { demo: false, realToday: "2026-01-01" as IsoDate })).toBe("2026-01-11");
  });
  it("rejects fractional days", async () => {
    await expect(advanceClock(t.db, companyId, 1.5)).rejects.toThrow(RangeError);
  });
});
