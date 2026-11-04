import { describe, expect, it } from "vitest";
import { addDays, type IsoDate } from "@/lib/dates";
import { tryLoadRules } from "@/lib/rules/load";
import { delta, project, statusAt, timelineEvents } from "./project";
import { EMPTY_SCENARIO, handlingOf, normalizeScenario } from "./scenario";
import type { InterestRules, Scenario, WhatIfItem, WhatIfSnapshot } from "./types";

const TODAY = "2026-11-01" as IsoDate;

function rulesFor(state: string): InterestRules {
  const loaded = tryLoadRules(state);
  if (!loaded) throw new Error(`no rule file for ${state}`);
  return { state: loaded.file.state, version: loaded.file.version, interest: loaded.file.interest };
}

const item = (over: Partial<WhatIfItem> & Pick<WhatIfItem, "id">): WhatIfItem => ({
  payeeName: `Synthetic ${over.id}`,
  checkNumber: over.id,
  amountCents: 100_000,
  ownerState: "CA",
  status: "watching",
  presumedAbandonedDate: null,
  ddWindowStart: null,
  ddWindowEnd: null,
  reportDueDate: null,
  remitDueDate: null,
  reportStage: null,
  unverified: true,
  ...over,
});

/** SYNTHETIC: CA item due in 30 days, CA item already late, TX item due in a year, DE item (unsupported basis). */
const ITEMS: WhatIfItem[] = [
  item({ id: "ca-soon", presumedAbandonedDate: "2026-11-20", ddWindowStart: "2026-11-01", ddWindowEnd: "2026-11-15", reportDueDate: "2026-12-01", remitDueDate: "2027-06-15" }),
  item({ id: "ca-late", status: "to_report", amountCents: 50_000, reportDueDate: "2026-10-01", remitDueDate: "2027-06-15" }),
  item({ id: "tx-year", ownerState: "TX", amountCents: 200_000, reportDueDate: "2027-07-01", remitDueDate: "2027-07-01" }),
  item({ id: "de-one", ownerState: "DE", amountCents: 30_000, reportDueDate: "2027-03-01", remitDueDate: "2027-03-01" }),
];

const snap = (items: WhatIfItem[] = ITEMS, rules?: WhatIfSnapshot["rules"]): WhatIfSnapshot => ({
  today: TODAY,
  items,
  rules: rules ?? { CA: rulesFor("CA"), TX: rulesFor("TX"), DE: rulesFor("DE") },
});
const sc = (s: Partial<Scenario>): Scenario => ({ ...EMPTY_SCENARIO, ...s });

describe("normalizeScenario", () => {
  it("clamps the offset to 0..730, drops unknown ids/states and lets paid win over next report", () => {
    const s = normalizeScenario({ offset: 9999, paid: ["ca-soon", "nope", "ca-soon"], nextReport: ["ca-soon", "tx-year"], onTimeStates: ["ca", "ZZ", "UNKNOWN"] }, snap());
    expect(s).toEqual({ offset: 730, paid: ["ca-soon"], nextReport: ["tx-year"], onTimeStates: ["CA"] });
    expect(normalizeScenario({ offset: -5 }, snap()).offset).toBe(0);
    expect(normalizeScenario({ offset: Number.NaN }, snap()).offset).toBe(0);
  });

  it("maps scenarios to handling", () => {
    const s = sc({ paid: ["ca-late"], nextReport: ["tx-year"], onTimeStates: ["CA"] });
    expect(handlingOf(ITEMS[0]!, s)).toBe("on_time");
    expect(handlingOf(ITEMS[1]!, s)).toBe("paid");
    expect(handlingOf(ITEMS[2]!, s)).toBe("on_time");
    expect(handlingOf(ITEMS[3]!, s)).toBe("miss");
  });
});

describe("projection math", () => {
  it("offset 0 with no scenario: exposure is every open, unfiled item; already-late obligations count as missed", () => {
    const p = project(snap(), EMPTY_SCENARIO);
    expect(p.asOf).toBe(TODAY);
    expect(p.exposure.cents).toBe(380_000);
    expect(p.exposure.byState.map((s) => [s.state, s.cents])).toEqual([["TX", 200_000], ["CA", 150_000], ["DE", 30_000]]);
    expect(p.deadlines.missed).toBe(1); // ca-late's report
    expect(Object.values(p.crossings).every((n) => n === 0)).toBe(true);
  });

  it("doing nothing for longer misses more deadlines and crosses dates, exposure unchanged", () => {
    const p0 = project(snap(), EMPTY_SCENARIO);
    const p = project(snap(), sc({ offset: 365 }));
    expect(p.deadlines.missed).toBeGreaterThan(p0.deadlines.missed);
    expect(p.crossings.presumed_abandoned).toBe(1);
    expect(p.crossings.dd_window_end).toBe(1);
    expect(p.crossings.report_due).toBe(3); // ca-soon Dec 1, de-one Mar 1, tx-year Jul 1 2027
    expect(delta(p0, p).exposureCents).toBe(0);
  });

  it("owner responds and is paid lowers exposure by exactly the item amount at any offset", () => {
    for (const offset of [0, 200, 730]) {
      const base = project(snap(), sc({ offset }));
      const paid = project(snap(), sc({ offset, paid: ["tx-year"] }));
      expect(delta(base, paid).exposureCents).toBe(-200_000);
    }
  });

  it("filing a state on its due dates removes it from exposure once filed and stops missed deadlines", () => {
    const miss = project(snap(), sc({ offset: 365 }));
    const file = project(snap(), sc({ offset: 365, onTimeStates: ["CA"] }));
    expect(file.exposure.byState.find((s) => s.state === "CA")).toBeUndefined();
    expect(file.deadlines.missed).toBeLessThan(miss.deadlines.missed);
    // Before ca-soon's report date it is still exposed; ca-late is caught up today.
    const early = project(snap(), sc({ offset: 10, onTimeStates: ["CA"] }));
    expect(early.exposure.byState.find((s) => s.state === "CA")?.cents).toBe(100_000);
  });

  it("remit with next report applies on-time handling to one item only", () => {
    const p = project(snap(), sc({ offset: 365, nextReport: ["tx-year"] }));
    expect(p.exposure.byState.find((s) => s.state === "TX")).toBeUndefined();
    expect(p.exposure.byState.find((s) => s.state === "CA")?.cents).toBe(150_000);
  });

  it("statusAt walks dd_sent -> reported -> remitted on the due dates, and stays put when missing", () => {
    const ca = ITEMS[0]!;
    expect(statusAt(ca, "on_time", TODAY, TODAY)).toBe("dd_sent");
    expect(statusAt(ca, "on_time", TODAY, "2026-12-01" as IsoDate)).toBe("reported");
    expect(statusAt(ca, "on_time", TODAY, "2027-06-15" as IsoDate)).toBe("remitted");
    expect(statusAt(ca, "miss", TODAY, "2028-01-01" as IsoDate)).toBe("watching");
    expect(statusAt(ca, "paid", TODAY, TODAY)).toBe("resolved_paid");
  });

  it("timeline events: missed obligations pink, on-time ones met, paid ones moot", () => {
    const miss = timelineEvents(snap(), EMPTY_SCENARIO).filter((e) => e.itemId === "ca-soon");
    expect(miss.map((e) => e.kind)).toEqual(["dd_window_end", "presumed_abandoned", "report_due", "remit_due"]);
    expect(miss.filter((e) => e.kind !== "presumed_abandoned").every((e) => e.outcome === "missed")).toBe(true);
    const ok = timelineEvents(snap(), sc({ onTimeStates: ["CA"] }));
    expect(ok.find((e) => e.key === "ca-soon:report_due")?.outcome).toBe("met");
    expect(ok.find((e) => e.key === "ca-late:report_due")?.outcome).toBe("missed"); // already late; caught up today
    const paid = timelineEvents(snap(), sc({ paid: ["ca-soon"] }));
    expect(paid.filter((e) => e.itemId === "ca-soon").every((e) => e.outcome === "moot")).toBe(true);
  });
});

describe("interest accrual vs the sourced rule", () => {
  it("CA accrues 12% simple on a 365-day year from the report due date (CCP § 1577)", () => {
    const ca = rulesFor("CA");
    expect(ca.interest.value?.annualRatePct).toBe(12);
    const one = snap([item({ id: "x", amountCents: 100_000, reportDueDate: TODAY })], { CA: ca });
    const p = project(one, sc({ offset: 365 }));
    const line = p.interest.byState.find((s) => s.state === "CA")!;
    expect(line.cents).toBe(12_000);
    expect(line.verified).toBe(ca.interest.verified);
    expect(line.sources[0]?.url).toContain("1577");
    expect(p.interest.anyUnverified).toBe(!ca.interest.verified);
  });

  it("on-time filing never starts interest; a catch-up filing freezes what already accrued", () => {
    const late = item({ id: "late", status: "to_report", amountCents: 100_000, reportDueDate: addDays(TODAY, -73), remitDueDate: "2027-06-15" });
    const one = snap([late], { CA: rulesFor("CA") });
    const missNow = project(one, sc({ offset: 0 })).interest.cents!;
    expect(missNow).toBe(2_400); // 100000 * 12% * 73/365
    expect(project(one, sc({ offset: 365, onTimeStates: ["CA"] })).interest.cents).toBe(missNow);
    expect(project(one, sc({ offset: 365 })).interest.cents!).toBeGreaterThan(missNow);
    const future = snap([item({ id: "f", reportDueDate: "2026-12-01", remitDueDate: "2027-06-15" })], { CA: rulesFor("CA") });
    expect(project(future, sc({ offset: 730, onTimeStates: ["CA"] })).interest.cents).toBe(0);
  });

  it("owner paid items accrue nothing", () => {
    const p = project(snap(), sc({ offset: 400, paid: ["ca-soon", "ca-late"] }));
    expect(p.interest.byState.find((s) => s.state === "CA")).toBeUndefined();
  });
});

describe("UNKNOWN propagation", () => {
  it("an unsupported basis (DE monthly rate) is UNKNOWN; the total is UNKNOWN and the known subtotal is labelled", () => {
    const p = project(snap(), sc({ offset: 365 }));
    expect(p.interest.unknownStates).toEqual(["DE"]);
    expect(p.interest.cents).toBeNull();
    expect(p.interest.knownCents).toBe(p.interest.byState.reduce((a, s) => a + (s.cents ?? 0), 0));
    expect(delta(project(snap(), EMPTY_SCENARIO), p).interestCents).toBeNull();
  });

  it("a missing rule file, a missing owner state, or a missing report date is UNKNOWN, never a number", () => {
    const items = [
      item({ id: "nr", ownerState: "ZZ", reportDueDate: "2026-12-01" }),
      item({ id: "ns", ownerState: null, reportDueDate: "2026-12-01" }),
      item({ id: "nd", ownerState: "CA", reportDueDate: null }),
    ];
    const p = project(snap(items, { ZZ: null, UNKNOWN: null, CA: rulesFor("CA") }), sc({ offset: 100 }));
    expect(p.interest.byState.map((s) => [s.state, s.status, s.cents])).toEqual([
      ["CA", "unknown", null],
      ["UNKNOWN", "unknown", null],
      ["ZZ", "unknown", null],
    ]);
    expect(p.interest.cents).toBeNull();
    // An unknown report date is never filed and never counted as missed: it is counted as unknown.
    expect(p.deadlines.unknown).toBeGreaterThan(0);
    const filed = project(snap(items, { ZZ: null, UNKNOWN: null, CA: rulesFor("CA") }), sc({ offset: 100, onTimeStates: ["CA"] }));
    expect(filed.exposure.byState.find((s) => s.state === "CA")?.cents).toBe(100_000);
  });

  it("paying every DE item clears the UNKNOWN and gives a known total", () => {
    const p = project(snap(), sc({ offset: 365, paid: ["de-one"] }));
    expect(p.interest.unknownStates).toEqual([]);
    expect(p.interest.cents).toBe(p.interest.knownCents);
  });
});
