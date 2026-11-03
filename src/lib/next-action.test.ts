import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { duePhrase, nextAction, type NextActionInput } from "./next-action";

const asOf = "2026-11-01" as IsoDate;
const base: NextActionInput = {
  counts: { triage: 0, draft: 0, approve: 0, file: 0 },
  asOf,
  urgentApprovals: 0,
  urgentDeadline: null,
  unverifiedBlocking: 0,
  nextDeadline: null,
};
const withCounts = (c: Partial<NextActionInput["counts"]>, rest: Partial<NextActionInput> = {}): NextActionInput => ({
  ...base,
  ...rest,
  counts: { ...base.counts, ...c },
});

describe("nextAction priority", () => {
  it("1. urgent approvals beat everything, with the due phrase", () => {
    const a = nextAction(withCounts({ approve: 3, draft: 5, file: 1 }, { urgentApprovals: 2, urgentDeadline: "2026-11-02" as IsoDate, unverifiedBlocking: 4 }));
    expect(a).toMatchObject({ kind: "approve_urgent", label: "Approve 2 items", detail: "due tomorrow", href: "/approvals", count: 2, human: true });
  });

  it("2. any approvals come next", () => {
    const a = nextAction(withCounts({ approve: 1, draft: 5, file: 1 }));
    expect(a).toMatchObject({ kind: "approve", label: "Review 1 approval", count: 1, human: true });
  });

  it("urgent approvals are ignored when nothing is waiting (stale input never invents work)", () => {
    expect(nextAction(withCounts({ approve: 0 }, { urgentApprovals: 2 })).kind).toBe("all_clear");
  });

  it("3. items due for due diligence without a draft", () => {
    const a = nextAction(withCounts({ draft: 4, file: 2 }, { unverifiedBlocking: 3 }));
    expect(a).toMatchObject({ kind: "draft", label: "Draft letters for 4 items", href: "/items?view=draft-ready", human: false });
  });

  it("4. approved reports to file", () => {
    const a = nextAction(withCounts({ file: 1 }, { unverifiedBlocking: 3 }));
    expect(a).toMatchObject({ kind: "file", label: "File 1 approved report", href: "/reports?filter=approved" });
  });

  it("5. unverified rules that block dates", () => {
    const a = nextAction(withCounts({ triage: 2 }, { unverifiedBlocking: 12 }));
    expect(a).toMatchObject({ kind: "verify_rules", href: "/rules", count: 12, detail: "12 dates provisional" });
  });

  it("6. all clear names the next deadline", () => {
    const a = nextAction(withCounts({}, { nextDeadline: "2026-12-15" as IsoDate }));
    expect(a).toMatchObject({ kind: "all_clear", label: "All clear", detail: "Next deadline Dec 15, 2026" });
    expect(nextAction(base).detail).toBe("No upcoming deadlines");
  });

  it("asks for a ledger when every count is unknown", () => {
    const a = nextAction({ ...base, counts: { triage: null, draft: null, approve: null, file: null } });
    expect(a).toMatchObject({ kind: "setup", href: "/settings/integrations", count: null });
  });

  it("is deterministic: same input, same output", () => {
    const input = withCounts({ approve: 2 }, { urgentApprovals: 1, urgentDeadline: "2026-11-05" as IsoDate });
    expect(nextAction(input)).toEqual(nextAction(structuredClone(input)));
  });
});

describe("duePhrase", () => {
  it.each([
    ["2026-11-01", "due today"],
    ["2026-11-02", "due tomorrow"],
    ["2026-11-06", "due in 5 days"],
    ["2026-10-31", "overdue by 1 day"],
    ["2026-10-29", "overdue by 3 days"],
  ])("%s -> %s", (date, phrase) => {
    expect(duePhrase(asOf, date as IsoDate)).toBe(phrase);
  });
});
