import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { groupByDay } from "@/app/(app)/activity/density-model";
import { activityDensity, activityHours, listActivity, type ActivityClock } from "./activity";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

let t: TestDb;
let companyId: string;
const at = (s: string) => new Date(`${s}Z`);

// One real day (2026-11-04), the demo clock jumped four times, revisiting Nov 1 and Jun 20.
const clock: ActivityClock = {
  today: "2026-11-01",
  history: [
    { atMs: at("2026-11-04T08:00:00").getTime(), day: "2026-11-01" },
    { atMs: at("2026-11-04T09:00:00").getTime(), day: "2026-11-20" },
    { atMs: at("2026-11-04T10:00:00").getTime(), day: "2026-11-01" },
    { atMs: at("2026-11-04T11:00:00").getTime(), day: "2026-11-20" },
  ],
};
const EVENTS: Array<[string, string]> = [
  ["2026-11-04T08:10:00", "2026-11-01"],
  ["2026-11-04T08:50:00", "2026-11-01"],
  ["2026-11-04T09:30:00", "2026-11-20"],
  ["2026-11-04T10:15:00", "2026-11-01"],
  ["2026-11-04T11:05:00", "2026-11-20"],
  ["2026-11-04T11:45:00", "2026-11-20"],
];
const kinds = ["outreach"] as const;

beforeEach(async () => {
  t = await createTestDb();
  const fixture = await insertFixture(t.db, STANDARD_ITEMS);
  companyId = fixture.companyId;
  for (const [when] of EVENTS) {
    await t.db.insert(outreach).values({ companyId, staleItemId: fixture.ids.a!.staleId, channel: "letter", status: "draft", createdAt: at(when) });
  }
});
afterEach(async () => {
  await t.close();
});

describe("activity is a demo-calendar view", () => {
  it("puts each event on the demo day it happened on, one section per demo day, in a stable order", async () => {
    const page = await listActivity(t.db, companyId, { kinds, clock, limit: 50 });
    const byTime = new Map(EVENTS.map(([when, day]) => [at(when).toISOString(), day]));
    for (const e of page.entries) expect(e.demoDay).toBe(byTime.get(e.at.toISOString()));

    const groups = groupByDay(page.entries);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["2026-11-20", 3],
      ["2026-11-01", 3],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    // Newest real time first inside a demo day, and the same order on a second read.
    for (const g of groups) {
      const times = g.items.map((e) => e.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
    const again = await listActivity(t.db, companyId, { kinds, clock, limit: 50 });
    expect(again.entries.map((e) => e.id)).toEqual(page.entries.map((e) => e.id));
  });

  it("filters, counts and pages by demo day", async () => {
    const only = await listActivity(t.db, companyId, { kinds, clock, from: "2026-11-01", to: "2026-11-01" });
    expect(only.entries).toHaveLength(3);
    expect(only.entries.every((e) => e.demoDay === "2026-11-01")).toBe(true);

    const density = await activityDensity(t.db, companyId, { kinds, clock });
    expect(density.days.filter((d) => d.count > 0).map((d) => [d.day, d.count])).toEqual([
      ["2026-11-01", 3],
      ["2026-11-20", 3],
    ]);

    const hours = await activityHours(t.db, companyId, { kinds, clock }, "2026-11-20");
    expect(hours.filter((h) => h.count > 0).map((h) => [h.hour, h.count])).toEqual([
      [9, 1],
      [11, 2],
    ]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const p: Awaited<ReturnType<typeof listActivity>> = await listActivity(t.db, companyId, { kinds, clock, cursor, limit: 2 });
      seen.push(...p.entries.map((e) => e.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("clamps events from before the first clock log to today's demo date", async () => {
    const early: ActivityClock = { today: "2026-11-01", history: [{ atMs: at("2026-11-05T00:00:00").getTime(), day: "2030-01-01" }] };
    const page = await listActivity(t.db, companyId, { kinds, clock: early });
    expect(new Set(page.entries.map((e) => e.demoDay))).toEqual(new Set(["2026-11-01"]));
  });
});
