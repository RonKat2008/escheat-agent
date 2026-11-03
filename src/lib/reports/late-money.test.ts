import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { computeAuditInterest } from "@/lib/rules/engine";
import { rv, simpleFile } from "@/lib/rules/__fixtures__";
import { catchUpHref, summarizeLateMoney, type LateItemInput } from "./late-money";

const AS_OF = "2026-11-01" as IsoDate;

function item(over: Partial<LateItemInput> & { itemId: string }): LateItemInput {
  return {
    state: "TX",
    amount: { cents: 100_000 },
    status: "to_report",
    overdue: [{ kind: "report_due", date: "2026-07-01", verified: false }],
    ...over,
  };
}

const tx = simpleFile({ state: "TX", version: "tx-test", interest: rv({ annualRatePct: 12, basis: "simple" }, false) });
const noInterest = simpleFile({ state: "DE", version: "de-test", interest: rv<never>(null, false) });
const rules = (s: string) => (s === "TX" ? tx : s === "DE" ? noInterest : null);

describe("summarizeLateMoney", () => {
  it("returns an empty summary with no catch-up when nothing is late", () => {
    const r = summarizeLateMoney([], rules, AS_OF);
    expect(r).toMatchObject({ lateCount: 0, lateCents: 0, interestCents: null, interestVerified: false, catchUp: null, byState: [] });
  });

  it("computes interest with the same engine call the audit card uses, from the report due date", () => {
    const a = item({ itemId: "a", amount: { cents: 77_374 } });
    const r = summarizeLateMoney([a], rules, AS_OF);
    const engine = computeAuditInterest([{ id: "a", amountCents: 77_374, reportDueDate: "2026-07-01" as IsoDate }], tx, AS_OF);
    expect(engine.totalCents).toBeGreaterThan(0);
    expect(r.interestCents).toBe(engine.totalCents);
    expect(r.byState[0]!.interest).toEqual({ status: "ok", cents: engine.totalCents, verified: false, ruleVersion: "tx-test" });
    expect(r.interestStates).toEqual(["TX"]);
    expect(r.interestVerified).toBe(false);
    expect(r.lateCents).toBe(77_374);
  });

  it("says unknown, never a rate, when a state has no interest rule or no rule file", () => {
    const r = summarizeLateMoney([item({ itemId: "d", state: "DE" }), item({ itemId: "z", state: "ZZ" }), item({ itemId: "u", state: null })], rules, AS_OF);
    expect(r.interestCents).toBeNull();
    expect(r.unknownInterestStates).toEqual(["DE", "Unknown", "ZZ"]);
    for (const s of r.byState) expect(s.interest.status).toBe("unknown");
    expect(r.byState.find((s) => s.state === "DE")!.interest).toMatchObject({ reason: "Interest rule is unknown" });
  });

  it("does not accrue interest for items whose only missed date is the DD window", () => {
    const dd = item({ itemId: "dd", status: "dd_pending", overdue: [{ kind: "dd_window_end", date: "2026-10-01", verified: true }] });
    const r = summarizeLateMoney([dd], rules, AS_OF);
    expect(r.byState[0]!.interest).toEqual({ status: "none" });
    expect(r.byState[0]!.filingLateCount).toBe(0);
    expect(r.interestCents).toBeNull();
    expect(r.lateCount).toBe(1);
    expect(r.catchUp).toBeNull();
  });

  it("sums known states and keeps the unknown ones out of the total", () => {
    const r = summarizeLateMoney([item({ itemId: "a" }), item({ itemId: "b", state: "DE" })], rules, AS_OF);
    const txOnly = summarizeLateMoney([item({ itemId: "a" })], rules, AS_OF);
    expect(r.interestCents).toBe(txOnly.interestCents);
    expect(r.unknownInterestStates).toEqual(["DE"]);
    expect(r.lateCents).toBe(200_000);
  });

  it("is verified only when every known state rests on verified rule values", () => {
    const verified = simpleFile({ state: "TX", interest: rv({ annualRatePct: 12, basis: "simple" }, true) });
    const r = summarizeLateMoney([item({ itemId: "a", overdue: [{ kind: "report_due", date: "2026-07-01", verified: true }] })], () => verified, AS_OF);
    expect(r.interestVerified).toBe(true);
  });

  it("picks the supported state with the most late report money as the catch-up, counting items in To Report", () => {
    const r = summarizeLateMoney(
      [
        item({ itemId: "t1", amount: { cents: 77_374 } }),
        item({ itemId: "t2", amount: { cents: 10_000 }, status: "dd_sent" }),
        item({ itemId: "c1", state: "CA", amount: { cents: 50_000 } }),
        item({ itemId: "z1", state: "ZZ", amount: { cents: 999_999 } }),
        item({ itemId: "r1", state: "DE", status: "reported", amount: { cents: 500_000 }, overdue: [{ kind: "remit_due", date: "2026-07-01", verified: true }] }),
      ],
      rules,
      AS_OF,
    );
    expect(r.catchUp).toEqual({ state: "TX", count: 2, cents: 87_374, inReportCount: 1 });
  });

  it("breaks a tie by state code", () => {
    const r = summarizeLateMoney([item({ itemId: "t" }), item({ itemId: "c", state: "CA" })], rules, AS_OF);
    expect(r.catchUp?.state).toBe("CA");
  });
});

describe("catchUpHref", () => {
  it("deep-links the state's report in catch-up mode", () => {
    expect(catchUpHref("TX")).toBe("/reports?state=TX&catchup=1");
  });
});
