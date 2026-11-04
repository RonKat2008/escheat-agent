import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { companies } from "@/db/schema";
import { advanceClock, resetClock } from "./clock";
import { demoDayAt, loadClockHistory } from "./clock-history";

describe("clock history (R7-04, demo_clock_events)", () => {
  let prevAnchor: string | undefined;
  beforeAll(() => {
    prevAnchor = process.env.DEMO_ANCHOR_DATE;
    process.env.DEMO_ANCHOR_DATE = "2026-11-01";
  });
  afterAll(() => {
    if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
    else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  });

  it("logs every clock change and dates events by the demo day in force", async () => {
    const t = await createTestDb();
    try {
      const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
      const id = c!.id;
      await resetClock(t.db, id);
      const afterReset = Date.now();
      await new Promise((r) => setTimeout(r, 15));
      await advanceClock(t.db, id, 880); // 2026-11-01 + 880d = 2029-03-30
      const history = await loadClockHistory(t.db, id);
      expect(history.map((h) => h.day)).toEqual(["2026-11-01", "2029-03-30"]);
      expect(demoDayAt(new Date(afterReset + 1).toISOString(), history, "2029-03-30")).toBe("2026-11-01");
      expect(demoDayAt(new Date(Date.now() + 1000).toISOString(), history, "2029-03-30")).toBe("2029-03-30");
    } finally {
      await t.close();
    }
  });
});
