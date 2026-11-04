import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS, buildDensity } from "@/lib/queries/activity";
import { actorKind, dayAnchorId, groupByDay, humanKindsFor, seismoDays, toggleKind } from "./density-model";

describe("activity density bucketing", () => {
  const all = buildDensity(
    [
      { day: "2026-10-30", count: 4, attention: 1 },
      { day: "2026-11-01", count: 2, attention: 0 },
      { day: "2026-09-01", count: 9, attention: 0 }, // outside the 5-day window
    ],
    "2026-11-02",
    5,
  );

  it("keeps one bucket per day, gap-free and in order, with empty days at zero", () => {
    expect(all.days.map((d) => d.day)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(all.days.map((d) => d.count)).toEqual([0, 4, 0, 2, 0]);
    expect(all.total).toBe(6);
  });

  it("aligns approval counts to the same days, ignores days outside the window and caps them at the day total", () => {
    const human = buildDensity(
      [
        { day: "2026-10-30", count: 1, attention: 0 },
        { day: "2026-11-01", count: 5, attention: 0 }, // more than the day total: capped
        { day: "2026-10-01", count: 3, attention: 0 },
      ],
      "2026-11-02",
      5,
    );
    const days = seismoDays(all, human, new Set(["2026-11-01"]));
    expect(days.map((d) => d.human)).toEqual([0, 1, 0, 2, 0]);
    expect(days.map((d) => d.inFeed)).toEqual([false, false, false, true, false]);
    expect(days[1]!.attention).toBe(1);
  });

  it("scales both traces on the shared day maximum and draws nothing for empty days", () => {
    const days = seismoDays(all, null);
    expect(days.map((d) => d.up)).toEqual([0, 100, 0, 70.7, 0]);
    expect(days.every((d) => d.down === 0 && d.human === 0)).toBe(true);
  });

  it("groups a feed into sections by demo day", () => {
    const at = (demoDay: string) => ({ demoDay });
    const groups = groupByDay([at("2026-11-02"), at("2026-11-02"), at("2026-11-01"), at("2026-10-30")]);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["2026-11-02", 2],
      ["2026-11-01", 1],
      ["2026-10-30", 1],
    ]);
    expect(dayAnchorId("2026-11-02")).toBe("activity-day-2026-11-02");
  });
});

describe("activity actors and kind chips", () => {
  it("treats runs as the agent (even via chat), named actors as people and the rest as the system", () => {
    expect(actorKind({ kind: "run", actor: "via chat" })).toBe("agent");
    expect(actorKind({ kind: "approval", actor: "Dana" })).toBe("person");
    expect(actorKind({ kind: "ingestion", actor: null })).toBe("system");
  });

  it("asks for approvals only when the kind filter allows them", () => {
    expect(humanKindsFor(undefined)).toEqual(["approval"]);
    expect(humanKindsFor(["approval", "run"])).toEqual(["approval"]);
    expect(humanKindsFor(["run"])).toEqual([]);
  });

  it("toggles chips in canonical order", () => {
    expect(toggleKind(undefined, "run", ACTIVITY_KINDS)).toEqual(["run"]);
    expect(toggleKind(["run"], "approval", ACTIVITY_KINDS)).toEqual(["approval", "run"]);
    expect(toggleKind(["approval", "run"], "approval", ACTIVITY_KINDS)).toEqual(["run"]);
  });
});
