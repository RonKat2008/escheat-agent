import { describe, expect, it } from "vitest";
import type { IsoDate } from "../dates";
import { describeDerivation, describeRoll, ruleFieldLabel } from "./derivation";
import { computeTimeline, type TimelineInput } from "./engine";
import { rv, simpleFile } from "./__fixtures__";
import { loadRules } from "./load";

const d = (s: string) => s as IsoDate;

/** The dogfood item #10482: CA vendor check issued Sep 1 2025, $2,340, holder fiscal year end Dec 31. */
const ca10482: TimelineInput = {
  propertyType: "vendor_check",
  lastActivityDate: d("2025-09-01"),
  amountCents: 234_000,
  ownerState: "CA",
  clockDates: { issue_date: d("2025-09-01") },
  holderFiscalYearEnd: "12-31",
};

describe("engine derivation (F14)", () => {
  const ca = loadRules("CA").file;
  const t = computeTimeline(ca10482, ca);

  it("returns a structured derivation for every resolved date and none for unknown ones", () => {
    const resolved = [t.presumedAbandoned, t.ddWindow.start, t.ddWindow.end, t.remitDue, ...t.reportStages.flatMap((s) => [s.asOf, s.due])];
    for (const v of resolved) {
      if (v.status === "ok") expect(v.derivation?.steps.length).toBeGreaterThan(0);
      else expect(v.derivation ?? null).toBeNull();
    }
    const unknownFye = computeTimeline({ ...ca10482, holderFiscalYearEnd: undefined }, ca);
    expect(unknownFye.reportStages[0]!.due.status).toBe("unknown");
    expect(unknownFye.reportStages[0]!.due.derivation ?? null).toBeNull();
  });

  it("is deterministic", () => {
    expect(computeTimeline(ca10482, ca)).toEqual(t);
  });

  it("presumed abandoned reads as issue date + dormancy", () => {
    const lines = describeDerivation(t.presumedAbandoned.derivation!);
    expect(lines.join(" ")).toMatch(/Sep 1, 2025 \+ 3-year dormancy = Sep 1, 2028/);
  });

  it("report due shows the as-of date from the fiscal year end and why the year moved", () => {
    const due = t.reportStages[0]!.due;
    expect(due.date).toBe("2029-10-31");
    const text = describeDerivation(due.derivation!).join(" ");
    expect(text).toMatch(/fiscal year end \(Dec 31/);
    expect(text).toMatch(/Dec 31, 2028/);
    expect(text).toMatch(/Oct 31, 2028.*on or before.*Dec 31, 2028.*Oct 31, 2029/);
    expect(text).not.toMatch(/unknown/i);
  });

  it("due-diligence window opens = report due minus the window maximum", () => {
    const text = describeDerivation(t.ddWindow.start.derivation!).join(" ");
    expect(text).toMatch(/Oct 31, 2029 − 365 days = Oct 31, 2028/);
  });

  it("states the business-day roll (from, weekday, to, rule) when it changed a date (F27)", () => {
    const remit = t.remitDue;
    expect(remit.derivation?.roll).toMatchObject({ from: "2030-06-15", to: "2030-06-17", fromWeekday: 6, path: "businessDayRollForward" });
    const roll = describeRoll(remit.derivation!.roll!);
    expect(roll).toMatch(/Jun 15, 2030 is a Saturday/);
    expect(roll).toMatch(/rolled forward to Mon(day)?,? Jun 17, 2030/);
    expect(roll).toMatch(/Roll weekend\/holiday deadlines forward/);
    expect(describeDerivation(remit.derivation!).join(" ")).toMatch(/with the remit report/);
  });

  it("says when the roll rule is unverified and flags the before/on-or-before question for counsel", () => {
    const remit = t.remitDue;
    const roll = describeRoll(remit.derivation!.roll!);
    expect(roll).toMatch(/unverified/i);
    expect(roll).toMatch(/counsel/i);
  });

  it("no roll info when the date was already a business day", () => {
    expect(t.reportStages[0]!.due.derivation!.roll).toBeNull(); // Oct 31 2029 is a Wednesday
  });

  it("says when the dormancy clock fell back to the last-activity date", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.clockStartsFrom = rv("payable_date" as const);
    const tl = computeTimeline({ propertyType: "vendor_check", lastActivityDate: d("2024-03-01"), amountCents: 1, ownerState: "ZZ" }, f);
    expect(describeDerivation(tl.presumedAbandoned.derivation!).join(" ")).toMatch(/payable date.*none on file.*Mar 1, 2024/i);
  });
});

describe("ruleFieldLabel", () => {
  it("expands rule paths into readable names", () => {
    expect(ruleFieldLabel("propertyTypes.vendor_check.dormancyYears")).toBe("Vendor check: dormancy period");
    expect(ruleFieldLabel("reportStages[notice].dueRule")).toBe("Report stage notice: report due");
    expect(ruleFieldLabel("businessDayRollForward")).toBe("Roll weekend/holiday deadlines forward");
  });
});
