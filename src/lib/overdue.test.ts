import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { assessOverdue, assessPersisted, isPastDue, lateLabel, obligationPending, overdueShort, type PersistedDates } from "./overdue";

const D = (s: string) => s as IsoDate;
const ANCHOR = D("2026-11-01");

const tx10357: PersistedDates = {
  status: "to_report",
  ddWindowEnd: "2026-05-02",
  reportDueDate: "2026-07-01",
  remitDueDate: "2026-07-01",
  reportStage: "report",
  dependsOnUnverified: false,
};

describe("assessOverdue", () => {
  it("flags a report and remittance due before today as overdue, earliest first, with days late", () => {
    const a = assessPersisted(tx10357, ANCHOR);
    expect(a.state).toBe("overdue");
    expect(a.overdue.map((o) => o.kind)).toEqual(["report_due", "remit_due"]);
    expect(a.earliest).toMatchObject({ kind: "report_due", date: "2026-07-01", daysLate: 123 });
    expect(a.daysLate).toBe(123);
    expect(a.verified).toBe(true);
  });

  it("a date due today is not overdue", () => {
    const a = assessPersisted({ ...tx10357, reportDueDate: "2026-11-01", remitDueDate: "2026-11-01" }, ANCHOR);
    expect(a.state).toBe("on_track");
    expect(a.overdue).toEqual([]);
    expect(isPastDue("2026-11-01", ANCHOR)).toBe(false);
    expect(isPastDue("2026-10-31", ANCHOR)).toBe(true);
  });

  it("is overdue the day after the due date", () => {
    const a = assessPersisted({ ...tx10357, reportDueDate: "2026-11-01", remitDueDate: "2026-11-01" }, D("2026-11-02"));
    expect(a.state).toBe("overdue");
    expect(a.daysLate).toBe(1);
  });

  it("an unknown date is never overdue and is reported as date_unknown", () => {
    const a = assessPersisted({ ...tx10357, status: "needs_rule", ddWindowEnd: null, reportDueDate: null, remitDueDate: null }, ANCHOR);
    expect(a.state).toBe("date_unknown");
    expect(a.overdue).toEqual([]);
    expect(a.unknown).toEqual(["report_due", "remit_due"]);
  });

  it("an engine `unknown` status wins over any date and never counts as late", () => {
    const a = assessOverdue(
      { status: "to_report", obligations: [{ kind: "report_due", date: "2020-01-01", status: "unknown", verified: false }] },
      ANCHOR,
    );
    expect(a.state).toBe("date_unknown");
  });

  it("a known past date is still overdue when another date is unknown", () => {
    const a = assessPersisted({ ...tx10357, remitDueDate: null }, ANCHOR);
    expect(a.state).toBe("overdue");
    expect(a.unknown).toEqual(["remit_due"]);
  });

  it("not_applicable obligations are ignored", () => {
    const a = assessOverdue(
      { status: "watching", obligations: [{ kind: "dd_window_end", date: null, status: "not_applicable", verified: true }] },
      ANCHOR,
    );
    expect(a.state).toBe("on_track");
  });

  it.each(["resolved_paid", "remitted"] as const)("a completed obligation (%s) is done, not overdue", (status) => {
    const a = assessPersisted({ ...tx10357, status }, ANCHOR);
    expect(a.state).toBe("done");
    expect(a.overdue).toEqual([]);
  });

  it("a reported item with a passed remit date is overdue on the remittance only (R3-07)", () => {
    const a = assessPersisted({ ...tx10357, status: "reported" }, ANCHOR);
    expect(a.state).toBe("overdue");
    expect(a.overdue.map((o) => o.kind)).toEqual(["remit_due"]);
    expect(a.daysLate).toBeGreaterThan(0);
  });

  it("a reported item whose remit date has not passed is on track, and one with no remit date is date_unknown", () => {
    expect(assessPersisted({ ...tx10357, status: "reported", remitDueDate: "2027-01-01" }, ANCHOR).state).toBe("on_track");
    expect(assessPersisted({ ...tx10357, status: "reported", remitDueDate: null }, ANCHOR).state).toBe("date_unknown");
  });

  it("a past DD close is overdue only while the letter is still owed", () => {
    const row = { ...tx10357, ddWindowEnd: "2026-10-01", reportDueDate: "2027-11-01", remitDueDate: "2027-11-01" };
    expect(assessPersisted({ ...row, status: "dd_pending" }, ANCHOR).earliest?.kind).toBe("dd_window_end");
    expect(assessPersisted({ ...row, status: "dd_sent" }, ANCHOR).state).toBe("on_track");
    expect(assessPersisted({ ...row, status: "owner_responded" }, ANCHOR).state).toBe("on_track");
    expect(obligationPending("dd_window_end", "to_report")).toBe(false);
    expect(obligationPending("report_due", "dd_sent")).toBe(true);
  });

  it("resetting the clock to the anchor clears overdue that an advanced clock produced", () => {
    const ca = { ...tx10357, status: "watching" as const, ddWindowEnd: "2027-05-02", reportDueDate: "2027-11-01", remitDueDate: "2027-11-01" };
    expect(assessPersisted(ca, D("2027-05-02")).state).toBe("on_track"); // DD close due today
    const advanced = assessPersisted(ca, D("2027-12-01"));
    expect(advanced.state).toBe("overdue");
    expect(advanced.earliest?.kind).toBe("dd_window_end");
    expect(assessPersisted(ca, ANCHOR).state).toBe("on_track"); // reset: same row, anchor date
  });

  it("keeps the UNVERIFIED marker of the rule values a missed date rests on", () => {
    const a = assessPersisted({ ...tx10357, dependsOnUnverified: true }, ANCHOR);
    expect(a.state).toBe("overdue");
    expect(a.verified).toBe(false);
    expect(a.overdue.every((o) => !o.verified)).toBe(true);
  });
});

describe("labels", () => {
  it("formats days late", () => {
    expect(lateLabel(1)).toBe("1 day late");
    expect(lateLabel(123)).toBe("123 days late");
    expect(overdueShort(5)).toBe("Overdue 5d");
    expect(overdueShort(123)).toBe("Overdue 4mo");
    expect(overdueShort(400)).toBe("Overdue 1y");
  });
});
