import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { humanDate, planBulkDraft, summarizePlan, type PlanItem, type PlanRuleLookup } from "./bulk-plan";

const NOW = "2026-11-01" as IsoDate;

const rules: PlanRuleLookup = (state) => {
  if (state === "CA") return { requiredLanguage: "Verbatim CA notice language." };
  if (state === "TX") return { requiredLanguage: null }; // UNKNOWN in the rule file
  return null; // no rule file
};

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: crypto.randomUUID(),
  status: "dd_pending",
  ownerState: "CA",
  ddWindowStart: "2026-11-01",
  hasOwnerAddress: true,
  existing: [],
  ...over,
});

const only = (i: PlanItem, opts?: Parameters<typeof planBulkDraft>[3]) => planBulkDraft([i], NOW, rules, opts)[0]!;

describe("planBulkDraft", () => {
  it("will_draft for an eligible item (window opens today counts as open)", () => {
    expect(only(item())).toMatchObject({ decision: "will_draft" });
  });

  it("an item with no stored window start is not blocked on the window (the rules engine left it null)", () => {
    expect(only(item({ ddWindowStart: null }))).toMatchObject({ decision: "will_draft" });
  });

  it("rule_unknown names the missing rule value for a TX letter whose notice language is UNKNOWN", () => {
    const e = only(item({ ownerState: "TX" }));
    expect(e).toMatchObject({ decision: "skip", code: "rule_unknown", detail: { rule: "dueDiligence.requiredLanguage", state: "TX" } });
    if (e.decision === "skip") expect(e.message).toMatch(/notice wording for TX has not been set/);
  });

  it("rule_unknown for a state with no rule file", () => {
    expect(only(item({ ownerState: "ZZ" }))).toMatchObject({ code: "rule_unknown", detail: { rule: "ruleFile", state: "ZZ" } });
  });

  it("rule_unknown for needs_rule items", () => {
    expect(only(item({ status: "needs_rule" }))).toMatchObject({ code: "rule_unknown" });
  });

  it("the required-language rule only blocks letters, not email or voice", () => {
    expect(only(item({ ownerState: "TX" }), { channel: "email" })).toMatchObject({ decision: "will_draft" });
    expect(only(item({ ownerState: "TX" }), { channel: "voice" })).toMatchObject({ decision: "will_draft" });
  });

  it("window_not_open reports the date, including a window years away", () => {
    const e = only(item({ ddWindowStart: "2030-05-02" }));
    expect(e).toMatchObject({ decision: "skip", code: "window_not_open", detail: { opensOn: "2030-05-02", state: "CA" } });
    if (e.decision === "skip") expect(e.message).toContain("May 2, 2030");
  });

  it("window_not_open: the day before the window opens is skipped, the day it opens is drafted", () => {
    expect(only(item({ ddWindowStart: "2026-11-02" }))).toMatchObject({ code: "window_not_open" });
    expect(only(item({ ddWindowStart: "2026-10-31" }))).toMatchObject({ decision: "will_draft" });
  });

  it("already_drafted for waiting, approved and sent outreach", () => {
    for (const status of ["draft", "awaiting_approval", "approved", "sent"] as const) {
      expect(only(item({ existing: [{ status }] }))).toMatchObject({ code: "already_drafted" });
    }
  });

  it("closed for paid, reported, remitted and to_report items", () => {
    for (const status of ["resolved_paid", "reported", "remitted", "to_report"] as const) {
      expect(only(item({ status }))).toMatchObject({ code: "closed" });
    }
  });

  it("missing_owner_address blocks letters only", () => {
    expect(only(item({ hasOwnerAddress: false }))).toMatchObject({ code: "missing_owner_address" });
    expect(only(item({ hasOwnerAddress: false }), { channel: "email" })).toMatchObject({ decision: "will_draft" });
  });

  it("owner_state_unknown when there is no owner state", () => {
    expect(only(item({ ownerState: null }))).toMatchObject({ code: "owner_state_unknown" });
  });

  it("precedence: closed beats everything, rule_unknown beats window_not_open", () => {
    expect(only(item({ status: "reported", ownerState: "TX", ddWindowStart: "2030-01-01" }))).toMatchObject({ code: "closed" });
    expect(only(item({ ownerState: "TX", ddWindowStart: "2030-01-01" }))).toMatchObject({ code: "rule_unknown" });
  });

  it("keeps input order and summarizes by reason", () => {
    const items = [item(), item({ ownerState: "TX" }), item({ ownerState: "TX" }), item({ ddWindowStart: "2029-01-01" })];
    const plan = planBulkDraft(items, NOW, rules);
    expect(plan.map((p) => p.staleItemId)).toEqual(items.map((i) => i.id));
    expect(summarizePlan(plan)).toEqual({ total: 4, willDraft: 1, skipped: 3, byReason: { rule_unknown: 2, window_not_open: 1 } });
  });

  it("humanDate formats ISO dates and passes anything else through", () => {
    expect(humanDate("2030-05-02")).toBe("May 2, 2030");
    expect(humanDate("soon")).toBe("soon");
  });
});
