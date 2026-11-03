import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { tryLoadRules } from "@/lib/rules/load";
import type { RuleFile } from "../../../rules/schema";
import { summarizeLateMoney, type LateItemInput } from "./late-money";

// R4-06: a reported-but-unremitted item accrues interest from its remit due date, per the sourced CA rule.
const ca = (): RuleFile => tryLoadRules("CA")!.file;
const remitLate = (): LateItemInput => ({
  itemId: "cw",
  state: "CA",
  amount: { cents: 157_410 },
  status: "reported",
  overdue: [{ kind: "remit_due", date: "2027-06-15", verified: false }],
});
const AS_OF = "2027-11-01" as IsoDate;

describe("late remittance interest (real CA rule)", () => {
  it("accrues the rule's 12% from the remit due date: 139 days late on $1,574.10 is $71.93, still UNVERIFIED", () => {
    const rules = ca();
    expect(rules.interest.value?.annualRatePct).toBe(12);
    const r = summarizeLateMoney([remitLate()], (s) => (s === "CA" ? rules : null), AS_OF);
    expect(r.byState[0]!.interest).toMatchObject({ status: "ok", cents: 7193, verified: rules.interest.verified });
    expect(r.interestCents).toBe(7193);
    expect(r.interestStates).toEqual(["CA"]);
    expect(r.interestVerified).toBe(rules.interest.verified);
  });

  it("is UNKNOWN, never a number, when the rule value is null", () => {
    const nullRule = { ...ca(), interest: { ...ca().interest, value: null } } as RuleFile;
    const r = summarizeLateMoney([remitLate()], () => nullRule, AS_OF);
    expect(r.interestCents).toBeNull();
    expect(r.unknownInterestStates).toEqual(["CA"]);
  });

  it("is UNKNOWN when the rule text does not say late payment starts interest", () => {
    const reportOnly = {
      ...ca(),
      interest: { ...ca().interest, value: { annualRatePct: 12, basis: "simple per annum from the filing date" } },
    } as RuleFile;
    const r = summarizeLateMoney([remitLate()], () => reportOnly, AS_OF);
    expect(r.interestCents).toBeNull();
    expect(r.byState[0]!.interest.status).toBe("unknown");
  });
});
