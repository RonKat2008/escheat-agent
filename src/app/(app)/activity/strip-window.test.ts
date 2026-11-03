import { describe, expect, it } from "vitest";
import type { SeismoDay } from "./density-model";
import { hourCaption, MIN_GAP_DAYS, planStrip, stripHeading } from "./strip-window";

const cell = (day: string, count: number, attention = 0): SeismoDay => ({ day, count, human: 0, attention, up: count ? 50 : 0, down: 0, inFeed: false });
const run = (start: number, counts: number[]): SeismoDay[] => counts.map((c, i) => cell(`2026-10-${String(start + i).padStart(2, "0")}`, c));
const fmt = (iso: string) => iso.slice(5);

describe("planStrip", () => {
  it("is empty when nothing is recorded", () => {
    expect(planStrip(run(1, [0, 0, 0]))).toEqual({ mode: "empty" });
  });

  it("switches to hours when every entry falls on one day", () => {
    expect(planStrip(run(1, [0, 0, 62, 0, 0]))).toEqual({ mode: "hours", day: "2026-10-03" });
  });

  it("fits the window to the active range, dropping empty edges", () => {
    const plan = planStrip(run(1, [0, 0, 3, 1, 2, 0, 0, 0]));
    if (plan.mode !== "days") throw new Error("expected days");
    expect(plan.from).toBe("2026-10-03");
    expect(plan.to).toBe("2026-10-05");
    expect(plan.quietDays).toBe(0);
    expect(plan.items.map((i) => i.type)).toEqual(["day", "day", "day"]);
  });

  it("keeps a short empty stretch as empty days", () => {
    const plan = planStrip(run(1, [2, 0, 0, 4]));
    if (plan.mode !== "days") throw new Error("expected days");
    expect(MIN_GAP_DAYS).toBeGreaterThan(2);
    expect(plan.items).toHaveLength(4);
    expect(plan.quietDays).toBe(0);
  });

  it("compresses a long empty stretch into one labelled gap, never dropping the days silently", () => {
    const plan = planStrip(run(1, [5, ...Array<number>(12).fill(0), 7]));
    if (plan.mode !== "days") throw new Error("expected days");
    expect(plan.items.map((i) => i.type)).toEqual(["day", "gap", "day"]);
    expect(plan.items[1]).toEqual({ type: "gap", from: "2026-10-02", to: "2026-10-13", days: 12 });
    expect(plan.quietDays).toBe(12);
    expect(plan.from).toBe("2026-10-01");
    expect(plan.to).toBe("2026-10-14");
  });
});

describe("strip wording", () => {
  it("states the window and aggregation for the hourly view", () => {
    expect(stripHeading({ mode: "hours", day: "2026-11-03" }, fmt)).toBe("entries on 11-03, by hour");
  });

  it("states the window and aggregation for the daily view", () => {
    const plan = { mode: "days" as const, from: "2026-10-01", to: "2026-10-14", items: [], quietDays: 12 };
    expect(stripHeading(plan, fmt)).toBe("entries from 10-01 to 10-14, by day");
  });

  it("captions the busiest hour in UTC and attention", () => {
    const hours: SeismoDay[] = [
      { ...cell("2026-11-03", 3), hour: 9 },
      { ...cell("2026-11-03", 20, 2), hour: 14 },
    ];
    expect(hourCaption(hours)).toBe("Busiest hour 14:00 UTC with 20. 2 need attention.");
    expect(hourCaption([{ ...cell("2026-11-03", 1), hour: 0 }])).toBe("Busiest hour 00:00 UTC with 1.");
  });
});
