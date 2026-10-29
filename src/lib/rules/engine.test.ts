import { describe, expect, it } from "vitest";
import type { IsoDate } from "../dates";
import { computeAuditInterest, computeTimeline, type TimelineInput } from "./engine";
import { rv, simpleFile, twoStageFile } from "./__fixtures__";

const d = (s: string) => s as IsoDate;
const input = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  propertyType: "vendor_check",
  lastActivityDate: d("2024-02-29"),
  amountCents: 100_000,
  ownerState: "ZZ",
  ...over,
});
const dueRule = (month: number, day: number, yearOffset = 0) =>
  rv({ type: "fixed_date" as const, month, day, yearOffset });
const withDue = (m: number, dd: number, roll: boolean | null) =>
  simpleFile({
    reportStages: [
      { name: "annual", asOfRule: rv({ type: "fixed_cutoff" as const, month: 6, day: 30 }), dueRule: dueRule(m, dd), includesRemittance: true },
    ],
    businessDayRollForward: rv(roll),
  });

describe("presumed abandoned", () => {
  it("leap-day issue date + 3y clamps to Feb 28", () => {
    const t = computeTimeline(input(), simpleFile());
    expect(t.presumedAbandoned.date).toBe("2027-02-28");
    expect(t.presumedAbandoned.status).toBe("ok");
  });
  it("payroll uses its own (shorter) dormancy", () => {
    const t = computeTimeline(input({ propertyType: "payroll_check", lastActivityDate: d("2025-03-15") }), simpleFile());
    expect(t.presumedAbandoned.date).toBe("2026-03-15");
  });
  it("prefers the clock date named by the rule", () => {
    const t = computeTimeline(
      input({ clockDates: { issue_date: d("2024-01-10") }, lastActivityDate: d("2024-06-01") }),
      simpleFile(),
    );
    expect(t.presumedAbandoned.date).toBe("2027-01-10");
    expect(t.presumedAbandoned.notes).toEqual([]);
  });
  it("fractional dormancy becomes whole months", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.dormancyYears = rv(1.5);
    expect(computeTimeline(input({ lastActivityDate: d("2025-01-31") }), f).presumedAbandoned.date).toBe("2026-07-31");
  });
});

describe("fixed_cutoff boundaries", () => {
  it("presumed abandoned exactly ON the cutoff is reported in that year", () => {
    const t = computeTimeline(input({ lastActivityDate: d("2024-06-30") }), simpleFile());
    expect(t.presumedAbandoned.date).toBe("2027-06-30");
    expect(t.reportStages[0]!.asOf.date).toBe("2027-06-30");
    expect(t.reportStages[0]!.due.date).toBe("2027-11-01");
  });
  it("one day after the cutoff rolls to next year", () => {
    const t = computeTimeline(input({ lastActivityDate: d("2024-07-01") }), simpleFile());
    expect(t.reportStages[0]!.asOf.date).toBe("2028-06-30");
    expect(t.reportStages[0]!.due.date).toBe("2028-11-01");
  });
  it("one day before the cutoff stays in the year", () => {
    const t = computeTimeline(input({ lastActivityDate: d("2024-06-29") }), simpleFile());
    expect(t.reportStages[0]!.asOf.date).toBe("2027-06-30");
  });
  it("Feb 29 cutoff clamps in non-leap years", () => {
    const f = simpleFile();
    f.reportStages[0]!.asOfRule = rv({ type: "fixed_cutoff" as const, month: 2, day: 29 });
    const t = computeTimeline(input({ lastActivityDate: d("2024-02-29") }), f);
    expect(t.reportStages[0]!.asOf.date).toBe("2027-02-28");
  });
});

describe("business-day roll-forward", () => {
  // 2027-11-06 is a Saturday.
  it("rolls weekends to Monday only when the rule says true", () => {
    const t = computeTimeline(input(), withDue(11, 6, true));
    expect(t.reportStages[0]!.due.date).toBe("2027-11-08");
    expect(t.reportStages[0]!.due.notes.join(" ")).toMatch(/Rolled forward/);
    expect(t.remitDue.date).toBe("2027-11-08");
  });
  it("does not roll when false", () => {
    const t = computeTimeline(input(), withDue(11, 6, false));
    expect(t.reportStages[0]!.due.date).toBe("2027-11-06");
    expect(t.reportStages[0]!.due.verified).toBe(true);
  });
  it("null: no roll, noted, and flagged unverified (not unknown)", () => {
    const t = computeTimeline(input(), withDue(11, 6, null));
    const due = t.reportStages[0]!.due;
    expect(due.date).toBe("2027-11-06");
    expect(due.status).toBe("ok");
    expect(due.notes.join(" ")).toMatch(/roll-forward rule is unknown/);
    expect(t.presumedAbandoned.verified).toBe(true);
    const u = computeTimeline(input(), simpleFile({ ...withDue(11, 6, null), businessDayRollForward: rv<boolean>(null, false) }));
    expect(u.reportStages[0]!.due.verified).toBe(false);
  });
  it("weekday dates are untouched and holidays are honoured", () => {
    expect(computeTimeline(input(), withDue(11, 8, true)).reportStages[0]!.due.date).toBe("2027-11-08");
    const t = computeTimeline(input(), withDue(11, 6, true), { holidays: ["2027-11-08"] });
    expect(t.reportStages[0]!.due.date).toBe("2027-11-09");
  });
});

describe("due diligence window", () => {
  it("is [due - max, due - min]", () => {
    const t = computeTimeline(input(), simpleFile());
    expect(t.ddApplies).toBe(true);
    expect(t.ddWindow.start.date).toBe("2027-07-04");
    expect(t.ddWindow.end.date).toBe("2027-09-02");
  });
  it("below the DD minimum is not_applicable", () => {
    const t = computeTimeline(input({ amountCents: 4_999 }), simpleFile());
    expect(t.ddApplies).toBe(false);
    expect(t.ddWindow.start.status).toBe("not_applicable");
    expect(t.ddWindow.start.date).toBeNull();
    expect(t.anyUnknown).toBe(false);
  });
  it("exactly at the minimum applies", () => {
    expect(computeTimeline(input({ amountCents: 5_000 }), simpleFile()).ddApplies).toBe(true);
  });
  it("not required => not_applicable", () => {
    const f = simpleFile();
    f.dueDiligence.required = rv(false);
    expect(computeTimeline(input(), f).ddApplies).toBe(false);
  });
  it("open-ended window (max null) starts when presumed abandoned", () => {
    const f = simpleFile();
    f.dueDiligence.windowDaysBeforeReport = rv({ min: 60, max: null });
    const t = computeTimeline(input(), f);
    expect(t.ddWindow.start.date).toBe("2027-02-28");
    expect(t.ddWindow.start.notes.join(" ")).toMatch(/no earliest/);
    expect(t.ddWindow.end.date).toBe("2027-09-02");
  });
});

describe("chained stages (CA-like notice + report)", () => {
  it("second stage is notice due + 4 months", () => {
    const t = computeTimeline(input({ ownerState: "ZY" }), twoStageFile());
    expect(t.reportStages.map((s) => [s.name, s.due.date])).toEqual([
      ["notice", "2027-11-01"],
      ["report", "2028-03-01"],
    ]);
    expect(t.remitDue.date).toBe("2028-03-01");
    expect(t.ddWindow.end.date).toBe("2027-09-02"); // measured from the FIRST stage
  });
  it("after_stage_days chains and rolls last", () => {
    const f = twoStageFile();
    f.reportStages[1]!.dueRule = rv({ type: "after_stage_days" as const, stage: "notice", days: 5 });
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[1]!.due.date).toBe("2027-11-08"); // Mon Nov 1 + 5 = Sat Nov 6 -> Mon Nov 8
  });
  it("chaining uses the unrolled statutory date", () => {
    const f = twoStageFile();
    f.reportStages[0]!.dueRule = dueRule(11, 6); // Saturday
    f.reportStages[1]!.dueRule = rv({ type: "after_stage" as const, stage: "notice", months: 1 });
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[0]!.due.date).toBe("2027-11-08");
    expect(t.reportStages[1]!.due.date).toBe("2027-12-06"); // Nov 6 + 1 month (Monday)
  });
  it("a later fixed-date stage moves past the preceding stage's due date", () => {
    const f = twoStageFile();
    f.reportStages[1]!.dueRule = dueRule(2, 1, 0); // Feb 1 of as-of year is before the notice
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[1]!.due.date).toBe("2028-02-01");
    expect(t.reportStages[1]!.due.notes.join(" ")).toMatch(/moved to 2028/);
  });
  it("circular and dangling stage references are unknown, not crashes", () => {
    const f = twoStageFile();
    f.reportStages[0]!.dueRule = rv({ type: "after_stage" as const, stage: "report", months: 1 });
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[0]!.due.status).toBe("unknown");
    expect(t.reportStages[1]!.due.status).toBe("unknown");
    const g = twoStageFile();
    g.reportStages[1]!.dueRule = rv({ type: "after_stage" as const, stage: "ghost", months: 1 });
    expect(computeTimeline(input({ ownerState: "ZY" }), g).reportStages[1]!.due.status).toBe("unknown");
  });
});

describe("remittance rules", () => {
  it("after_stage months and fixed_date", () => {
    const f = simpleFile({ remitRule: rv({ type: "after_stage" as const, stage: "annual", months: 7 }) });
    expect(computeTimeline(input(), f).remitDue.date).toBe("2028-06-01");
    const g = simpleFile({ remitRule: rv({ type: "fixed_date" as const, month: 6, day: 15, yearOffset: 1 }) });
    expect(computeTimeline(input(), g).remitDue.date).toBe("2028-06-15");
    const h = simpleFile({ remitRule: rv({ type: "after_stage_days" as const, stage: "annual", days: 30 }) });
    expect(computeTimeline(input(), h).remitDue.date).toBe("2027-12-01");
  });
});

describe("unknown propagation", () => {
  it("null dormancy makes everything downstream unknown", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.dormancyYears = rv<number>(null, false);
    const t = computeTimeline(input(), f);
    expect(t.presumedAbandoned).toMatchObject({ date: null, status: "unknown", verified: false });
    expect(t.reportStages[0]!.due.date).toBeNull();
    expect(t.ddWindow.start.date).toBeNull();
    expect(t.remitDue.date).toBeNull();
    expect(t.anyUnknown).toBe(true);
    expect(t.anyUnverified).toBe(true);
  });
  it("null clockStartsFrom is unknown", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.clockStartsFrom = rv<"issue_date">(null, false);
    expect(computeTimeline(input(), f).presumedAbandoned.status).toBe("unknown");
  });
  it("null due rule affects only that stage and its dependents", () => {
    const f = twoStageFile();
    f.reportStages[1]!.dueRule = rv<never>(null, false);
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[0]!.due.date).toBe("2027-11-01");
    expect(t.reportStages[1]!.due.status).toBe("unknown");
    expect(t.remitDue.status).toBe("unknown");
    expect(t.ddWindow.end.date).toBe("2027-09-02");
  });
  it("null first stage poisons the DD window", () => {
    const f = simpleFile();
    f.reportStages[0]!.dueRule = rv<never>(null, false);
    const t = computeTimeline(input(), f);
    expect(t.ddWindow.start.status).toBe("unknown");
    expect(t.presumedAbandoned.status).toBe("ok");
  });
  it("null DD window, required or min is unknown", () => {
    for (const k of ["windowDaysBeforeReport", "required", "minAmountCents"] as const) {
      const f = simpleFile();
      (f.dueDiligence[k] as { value: unknown }).value = null;
      const t = computeTimeline(input(), f);
      expect(t.ddWindow.start.status).toBe("unknown");
      expect(t.reportStages[0]!.due.status).toBe("ok");
    }
  });
  it("null remit rule", () => {
    const f = simpleFile({ remitRule: rv<never>(null, false) });
    expect(computeTimeline(input(), f).remitDue.status).toBe("unknown");
  });
  it("null thresholds yield null flags, not false", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.minAmountCents = rv<number>(null, false);
    f.propertyTypes.vendor_check!.aggregateThresholdCents = rv<number>(null, false);
    const t = computeTimeline(input(), f);
    expect(t.minAmountApplies).toBeNull();
    expect(t.aggregate).toBeNull();
    expect(t.anyUnknown).toBe(true);
  });
  it("fiscal_year_end needs the holder FYE", () => {
    const f = simpleFile();
    f.reportStages[0]!.asOfRule = rv({ type: "fiscal_year_end" as const });
    expect(computeTimeline(input(), f).reportStages[0]!.due.status).toBe("unknown");
    expect(computeTimeline(input({ holderFiscalYearEnd: "bogus" }), f).reportStages[0]!.due.status).toBe("unknown");
    const t = computeTimeline(input({ holderFiscalYearEnd: "12-31" }), f);
    expect(t.reportStages[0]!.asOf.date).toBe("2027-12-31");
    expect(t.reportStages[0]!.due.date).toBe("2028-11-01"); // Nov 1 2027 would precede the as-of date
  });
  it("missing property type, wrong state => all unknown", () => {
    const f = simpleFile();
    delete f.propertyTypes.unapplied_cash;
    const t = computeTimeline(input({ propertyType: "unapplied_cash" }), f);
    expect(t.anyUnknown).toBe(true);
    expect(t.presumedAbandoned.status).toBe("unknown");
    const w = computeTimeline(input({ ownerState: "CA" }), simpleFile());
    expect(w.presumedAbandoned.status).toBe("unknown");
    expect(w.warnings[0]).toMatch(/owner state/);
  });
});

describe("thresholds", () => {
  it("min and aggregate comparisons are strict <", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.minAmountCents = rv(1000);
    expect(computeTimeline(input({ amountCents: 999 }), f).minAmountApplies).toBe(true);
    expect(computeTimeline(input({ amountCents: 1000 }), f).minAmountApplies).toBe(false);
    expect(computeTimeline(input({ amountCents: 4999 }), f).aggregate).toBe(true);
    expect(computeTimeline(input({ amountCents: 5000 }), f).aggregate).toBe(false);
  });
});

describe("verified propagation", () => {
  it("fully verified fixture is verified end to end", () => {
    const t = computeTimeline(input(), simpleFile());
    expect(t.anyUnverified).toBe(false);
    expect(t.anyUnknown).toBe(false);
    for (const v of [t.presumedAbandoned, t.ddWindow.start, t.ddWindow.end, t.remitDue, t.reportStages[0]!.due]) {
      expect(v.verified).toBe(true);
    }
  });
  it("unverified dormancy taints every dependent date", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.dormancyYears = rv(3, false);
    const t = computeTimeline(input(), f);
    expect(t.presumedAbandoned.verified).toBe(false);
    expect(t.reportStages[0]!.due.verified).toBe(false);
    expect(t.ddWindow.start.verified).toBe(false);
    expect(t.remitDue.verified).toBe(false);
    expect(t.anyUnverified).toBe(true);
  });
  it("unverified roll rule taints due dates but not presumed abandoned", () => {
    const f = simpleFile({ businessDayRollForward: rv(true, false) });
    const t = computeTimeline(input(), f);
    expect(t.presumedAbandoned.verified).toBe(true);
    expect(t.reportStages[0]!.due.verified).toBe(false);
    expect(t.remitDue.verified).toBe(false);
  });
  it("unverified DD window taints only DD dates", () => {
    const f = simpleFile();
    f.dueDiligence.windowDaysBeforeReport = rv({ min: 60, max: 120 }, false);
    const t = computeTimeline(input(), f);
    expect(t.ddWindow.end.verified).toBe(false);
    expect(t.reportStages[0]!.due.verified).toBe(true);
  });
  it("chained stage inherits an unverified earlier stage", () => {
    const f = twoStageFile();
    f.reportStages[0]!.dueRule = rv({ type: "fixed_date" as const, month: 11, day: 1, yearOffset: 0 }, false);
    const t = computeTimeline(input({ ownerState: "ZY" }), f);
    expect(t.reportStages[1]!.due.verified).toBe(false);
  });
  it("unverified thresholds set anyUnverified", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.aggregateThresholdCents = rv(5000, false);
    expect(computeTimeline(input(), f).anyUnverified).toBe(true);
  });
  it("sources are carried on outputs", () => {
    const t = computeTimeline(input(), simpleFile());
    expect(t.presumedAbandoned.sources[0]!.url).toContain("example.test");
    expect(t.presumedAbandoned.ruleRefs.map((r) => r.path)).toContain("propertyTypes.vendor_check.dormancyYears");
  });
});

describe("version pinning", () => {
  it("two rule versions give different dates and each result records its version", () => {
    const v1 = simpleFile({ version: "v1" });
    const v2 = simpleFile({ version: "v2" });
    v2.propertyTypes.vendor_check!.dormancyYears = rv(5);
    const a = computeTimeline(input(), v1);
    const b = computeTimeline(input(), v2);
    expect(a.presumedAbandoned.date).toBe("2027-02-28");
    expect(b.presumedAbandoned.date).toBe("2029-02-28");
    expect(a.rules.version).toBe("v1");
    expect(b.rules.version).toBe("v2");
    expect(new Set(a.presumedAbandoned.ruleRefs.map((r) => r.version))).toEqual(new Set(["v1"]));
    expect(new Set(b.reportStages[0]!.due.ruleRefs.map((r) => r.version))).toEqual(new Set(["v2"]));
  });
});

describe("computeAuditInterest", () => {
  const items = [
    { id: "a", amountCents: 100_000, reportDueDate: d("2027-11-01") },
    { id: "b", amountCents: 50_000, reportDueDate: d("2027-11-01") },
  ];
  it("simple interest, 365 day year", () => {
    const r = computeAuditInterest(items, simpleFile(), d("2028-10-31")); // 365 days
    expect(r.status).toBe("ok");
    expect(r.items[0]).toMatchObject({ days: 365, interestCents: 12_000 });
    expect(r.items[1]!.interestCents).toBe(6_000);
    expect(r.totalCents).toBe(18_000);
    expect(r.verified).toBe(true);
  });
  it("zero before due, partial year rounds to cents", () => {
    expect(computeAuditInterest(items, simpleFile(), d("2027-10-01")).totalCents).toBe(0);
    const r = computeAuditInterest([items[0]!], simpleFile(), d("2027-12-01")); // 30 days
    expect(r.totalCents).toBe(Math.round((100_000 * 0.12 * 30) / 365));
  });
  it("360 basis", () => {
    const f = simpleFile({ interest: rv({ annualRatePct: 12, basis: "simple actual/360" }) });
    expect(computeAuditInterest([items[0]!], f, d("2027-12-01")).totalCents).toBe(Math.round((100_000 * 0.12 * 30) / 360));
  });
  it("null rule, compound and unrecognised bases are unknown", () => {
    for (const interest of [rv<never>(null, false), rv({ annualRatePct: 5, basis: "compound monthly" }), rv({ annualRatePct: 6, basis: "0.5% per month" })]) {
      const r = computeAuditInterest(items, simpleFile({ interest }), d("2028-10-31"));
      expect(r.status).toBe("unknown");
      expect(r.totalCents).toBeNull();
      expect(r.verified).toBe(false);
    }
  });
  it("missing due date makes the total unknown; unverified rule propagates", () => {
    const r = computeAuditInterest([...items, { id: "c", amountCents: 1, reportDueDate: null }], simpleFile({ interest: rv({ annualRatePct: 12, basis: "simple" }, false) }), d("2028-10-31"));
    expect(r.totalCents).toBeNull();
    expect(r.items[2]!.status).toBe("unknown");
    expect(r.verified).toBe(false);
    const u = computeAuditInterest(items, simpleFile({ interest: rv({ annualRatePct: 12, basis: "simple" }, false) }), d("2028-10-31"));
    expect(u.status).toBe("ok");
    expect(u.verified).toBe(false);
  });
  it("notes caps and penalties as not modelled", () => {
    const f = simpleFile({ interest: rv({ annualRatePct: 12, basis: "simple per annum; capped at $10,000" }) });
    expect(computeAuditInterest(items, f, d("2028-10-31")).notes.join(" ")).toMatch(/NOT modelled/);
  });
});
