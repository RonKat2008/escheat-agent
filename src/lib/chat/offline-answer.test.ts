import { describe, expect, it } from "vitest";
import { offlineAnswerText, sentenceFor, type ExecutedTool } from "./offline-answer";

const ok = (name: string, data: unknown, summary = "summary"): ExecutedTool => ({ name, ok: true, summary, data });

describe("offline answer text (R6-03): built only from tool output", () => {
  it("exposure: total, count, per-state figures and the UNVERIFIED flag, all copied from the tool", () => {
    const text = sentenceFor(
      ok("get_exposure", {
        asOf: "2026-12-16",
        total: "$54,566.13",
        itemCount: 44,
        anyUnverified: true,
        byState: [
          { state: "CA", total: "$26,000.00", count: 19 },
          { state: "TX", total: "$15,000.00", count: 14 },
        ],
      }),
    );
    expect(text).toBe(
      "As of Dec 16, 2026. You have **$54,566.13** across 44 open stale items. By state: CA $26,000.00 (19 items), TX $15,000.00 (14 items). Some of these figures rest on UNVERIFIED rule values.",
    );
  });

  it("deadlines: copies the first event's date and its UNVERIFIED flag; says nothing is due when empty", () => {
    const one = sentenceFor(
      ok("upcoming_deadlines", {
        asOf: "2026-11-01",
        days: 90,
        count: 1,
        unverifiedCount: 1,
        events: [{ date: "2026-11-02", kind: "report_due", verified: false, check: "10327", payee: "Callum Whitlock", state: "CA", amount: "$1,574.10" }],
      }),
    );
    expect(one).toContain("**1 deadline** in the next 90 days");
    expect(one).toContain("Report due on **Nov 2, 2026** (UNVERIFIED) for check #10327 (Callum Whitlock, CA, $1,574.10)");
    expect(one).toContain("It rests on UNVERIFIED rule values.");
    expect(sentenceFor(ok("upcoming_deadlines", { asOf: "2026-11-01", days: 30, count: 0, events: [] }))).toBe("As of Nov 1, 2026. Nothing falls due in the next 30 days.");
  });

  it("explain: the next timeline date comes from the tool, with its flag; UNKNOWN dates are called out", () => {
    const text = sentenceFor(
      ok("explain_item", {
        asOf: "2026-11-01",
        item: { check: "10087", payee: "Ravenhill Cabinetry", amount: "$2,194.70", ownerState: "CA", ageDays: 1077, status: "dd_pending" },
        timeline: [
          { event: "Presumed abandoned", date: "2026-11-20", flag: "UNVERIFIED" },
          { event: "Report due", date: null, flag: "UNKNOWN" },
        ],
      }),
    );
    expect(text).toBe(
      "Check #10087 is **$2,194.70** to Ravenhill Cabinetry, owed under CA rules, 1077 days old, status dd pending. Next on its timeline: Presumed abandoned on **Nov 20, 2026** (UNVERIFIED). At least one date is UNKNOWN because a rule value is missing.",
    );
  });

  it("drafts are described as drafts awaiting a person, never as sent", () => {
    const text = sentenceFor(ok("create_outreach_draft", { owner: "Ravenhill Cabinetry", amount: "$2,194.70", channel: "letter", status: "awaiting_approval", created: true, ready: true, problems: [] }));
    expect(text).toBe("Drafted the letter for Ravenhill Cabinetry (**$2,194.70**). Nothing was sent. It waits for a person to approve it in Approvals.");
    expect(text).not.toMatch(/\bsent to\b|approved/i);
  });

  it("a refused tool (rule engine said no) shows the refusal with its date, verbatim", () => {
    const refusal = "Due-diligence window opens on October 31, 2028. A notice sent earlier may not count. Nothing was drafted.";
    expect(offlineAnswerText([{ name: "create_outreach_draft", ok: false, summary: refusal, error: refusal }])).toBe(refusal);
  });

  it("reports: generated and validated, nothing filed; a held report repeats the tool's own reason", () => {
    expect(sentenceFor(ok("generate_report", { state: "CA", items: 1, total: "$1,574.10", errorCount: 0, warningCount: 14 }))).toBe(
      "Generated and validated the CA report: 1 item, **$1,574.10**, 0 errors and 14 warnings. Nothing was filed; filing needs a person's approval in the app.",
    );
    expect(sentenceFor(ok("generate_report", { regenerated: false, reason: "A CA report is already awaiting a person's approval." }))).toBe(
      "A CA report is already awaiting a person's approval.",
    );
  });

  it("close-out uses the runner counts (R6-04)", () => {
    const text = sentenceFor(
      ok("plan_close_out", { state: "TX", done: 0, total: 5, notNeeded: 3, atStake: "$773.74", items: 1, reportDue: "2026-07-01 (UNVERIFIED)", next: { step: "Verify the rules" } }),
    );
    expect(text).toBe("TX close-out: **0 of 5 steps done** · 3 not needed this cycle. **$773.74** at stake on 1 item. Report due Jul 1, 2026 (UNVERIFIED). Next: Verify the rules.");
  });

  it("rules: verified counts per state and who verifies", () => {
    expect(sentenceFor(ok("list_rules", { states: [{ state: "CA", verified: 0, unverified: 32 }, { state: "TX", verified: 2, unverified: 28 }] }))).toBe(
      "CA 0 of 32 verified, TX 2 of 30 verified. 60 rule values are still UNVERIFIED; only a person can verify them, at Rules.",
    );
  });

  it("an unknown tool or unexpected data falls back to the tool's own summary", () => {
    expect(sentenceFor(ok("get_clock", {}, "today is 2026-11-01"))).toBe("Today is 2026-11-01.");
    expect(sentenceFor(ok("get_exposure", { nope: true }, "47 open items, $61,915.00"))).toBe("47 open items, $61,915.00.");
  });
});
