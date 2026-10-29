import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { stateRules } from "@/db/schema";
import type { IsoDate } from "../dates";
import { computeAuditInterest, computeTimeline, type TimelineInput } from "./engine";
import { listRuleStates, loadRules, syncRulesToDb } from "./load";
import { listRuleValues } from "./values";

const d = (s: string) => s as IsoDate;
const base = (over: Partial<TimelineInput>): TimelineInput => ({
  propertyType: "vendor_check",
  lastActivityDate: d("2025-09-01"),
  amountCents: 234_000,
  ownerState: "CA",
  holderFiscalYearEnd: "12-31",
  ...over,
});

describe("real rule files (CA, DE, TX) load as-is", () => {
  it("all three parse with no warnings and all values unverified", () => {
    expect(listRuleStates()).toEqual(expect.arrayContaining(["CA", "DE", "TX"]));
    for (const st of ["CA", "DE", "TX"]) {
      const l = loadRules(st);
      expect(l.warnings, `${st} warnings`).toEqual([]);
      expect(l.file.reportStages.length).toBeGreaterThan(0);
      for (const v of listRuleValues(l.file)) expect(v.rv.verified, `${st} ${v.path}`).toBe(false);
    }
  });
  it("NAUPA codes and dormancy facts", () => {
    const ca = loadRules("CA").file;
    expect(ca.propertyTypes.payroll_check!.dormancyYears.value).toBe(1);
    expect(ca.propertyTypes.vendor_check!.dormancyYears.value).toBe(3);
    expect(loadRules("DE").file.propertyTypes.vendor_check!.dormancyYears.value).toBe(5);
    expect(loadRules("TX").file.propertyTypes.vendor_check!.naupaCode.value).toBe("MS04");
    expect(loadRules("TX").file.dueDiligence.windowDaysBeforeReport.value).toEqual({ min: 60, max: null });
    expect(loadRules("TX").file.dueDiligence.minAmountCents.value).toBe(25_001);
  });
});

describe("California (two-stage, fiscal-year-end based)", () => {
  const ca = () => loadRules("CA").file;
  it("vendor check issued 2025-09-01, FYE 12-31: notice 2029-10-31, remit June 15 of the following year", () => {
    const t = computeTimeline(base({}), ca());
    expect(t.presumedAbandoned.date).toBe("2028-09-01");
    expect(t.reportStages[0]).toMatchObject({ name: "notice" });
    expect(t.reportStages[0]!.asOf.date).toBe("2028-12-31");
    expect(t.reportStages[0]!.due.date).toBe("2029-10-31");
    expect(t.reportStages[1]!.name).toBe("remit");
    expect(t.reportStages[1]!.due.date).toBe("2030-06-17"); // Jun 15 2030 is a Saturday, rolled
    expect(t.remitDue.date).toBe("2030-06-17");
    expect(t.ddWindow.start.date).toBe("2028-10-31"); // 365 days before the notice due date
    expect(t.ddWindow.end.date).toBe("2029-05-01"); // 183 days before
    expect(t.ddApplies).toBe(true);
    expect(t.anyUnverified).toBe(true);
    expect(t.anyUnknown).toBe(false);
    expect(t.presumedAbandoned.ruleRefs[0]).toMatchObject({ state: "CA", version: "2026.10.0-draft" });
  });
  it("June 30 FYE keeps the notice in the same calendar year", () => {
    const t = computeTimeline(base({ holderFiscalYearEnd: "06-30" }), ca());
    expect(t.reportStages[0]!.asOf.date).toBe("2029-06-30");
    expect(t.reportStages[0]!.due.date).toBe("2029-10-31");
    expect(t.reportStages[1]!.due.date).toBe("2030-06-17"); // Sat Jun 15 rolled
  });
  it("without the holder FYE the dates are UNKNOWN (never defaulted)", () => {
    const t = computeTimeline(base({ holderFiscalYearEnd: undefined }), ca());
    expect(t.presumedAbandoned.status).toBe("ok");
    expect(t.reportStages[0]!.due.status).toBe("unknown");
    expect(t.anyUnknown).toBe(true);
  });
  it("payroll check has 1 year dormancy", () => {
    const t = computeTimeline(base({ propertyType: "payroll_check" }), ca());
    expect(t.presumedAbandoned.date).toBe("2026-09-01");
    expect(t.reportStages[0]!.due.date).toBe("2027-11-01"); // Sun Oct 31 rolled (note: statute says "before Nov 1"; roll rule unverified)
  });
  it("under $50 has no due diligence", () => {
    const t = computeTimeline(base({ amountCents: 4_999 }), ca());
    expect(t.ddApplies).toBe(false);
    expect(t.ddWindow.start.status).toBe("not_applicable");
  });
});

describe("Delaware (single stage, null roll-forward and thresholds)", () => {
  const de = () => loadRules("DE").file;
  it("vendor check: 5y dormancy, Mar 1 report; null values surface as unknown flags, not crashes", () => {
    const t = computeTimeline(base({ ownerState: "DE" }), de());
    expect(t.presumedAbandoned.date).toBe("2030-09-01");
    expect(t.reportStages[0]!.asOf.date).toBe("2030-12-31");
    expect(t.reportStages[0]!.due.date).toBe("2031-03-01"); // a Saturday; DE roll rule is null => no roll
    expect(t.reportStages[0]!.due.notes.join(" ")).toMatch(/roll-forward rule is unknown/);
    expect(t.ddWindow.start.date).toBe("2030-11-01");
    expect(t.ddWindow.end.date).toBe("2030-12-31");
    expect(t.minAmountApplies).toBeNull();
    expect(t.aggregate).toBeNull();
    expect(t.anyUnknown).toBe(true);
  });
  it("interest basis in prose is not approximated", () => {
    const r = computeAuditInterest([{ id: "x", amountCents: 100_000, reportDueDate: d("2031-03-01") }], de(), d("2032-03-01"));
    expect(r.status).toBe("unknown");
    expect(r.totalCents).toBeNull();
  });
});

describe("Texas (no earliest DD date, >$250 minimum, MS04)", () => {
  const tx = () => loadRules("TX").file;
  it("vendor check: 3y from last activity, Mar 1 as-of, Jul 1 due rolled off Sunday", () => {
    const t = computeTimeline(base({ ownerState: "TX" }), tx());
    expect(t.presumedAbandoned.date).toBe("2028-09-01");
    expect(t.reportStages[0]!.asOf.date).toBe("2029-03-01");
    expect(t.reportStages[0]!.due.date).toBe("2029-07-02");
    expect(t.ddWindow.end.date).toBe("2029-05-03"); // 60 days before the (rolled) due date
    expect(t.ddWindow.start.date).toBe("2028-09-01"); // no statutory earliest date: opens at presumption
    expect(t.ddWindow.start.notes.join(" ")).toMatch(/no earliest/);
    expect(t.aggregate).toBe(false); // $2,340 >= $25 aggregate threshold
    expect(t.minAmountApplies).toBeNull(); // TX per-type minimum is null in the file
    expect(t.anyUnknown).toBe(true);
  });
  it("DD applies only above $250.00", () => {
    expect(computeTimeline(base({ ownerState: "TX", amountCents: 25_000 }), tx()).ddApplies).toBe(false);
    expect(computeTimeline(base({ ownerState: "TX", amountCents: 25_001 }), tx()).ddApplies).toBe(true);
  });
  it("owner state mismatch with the file is unknown", () => {
    expect(computeTimeline(base({ ownerState: "TX" }), loadRules("CA").file).anyUnknown).toBe(true);
  });
});

describe("real files sync to PGlite", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });
  it("12 rows, none verified", async () => {
    const res = await syncRulesToDb(t.db);
    expect(res.map((r) => r.state)).toEqual(["CA", "DE", "TX"]);
    const rows = await t.db.select().from(stateRules);
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => r.verified)).toBe(false);
    expect(rows.find((r) => r.state === "TX" && r.propertyType === "vendor_check")!.ddWindowDaysMax).toBeNull();
  });
});
