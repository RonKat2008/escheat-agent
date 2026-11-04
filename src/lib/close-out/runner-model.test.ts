import { describe, expect, it } from "vitest";
import type { CloseStepId } from "@/lib/chat/ui-types";
import { deriveClosePlan, type CloseSnapshot, type SnapshotItem, type SnapshotReport } from "./derive";
import type { FilingRecord } from "@/lib/reports/filing-record";
import { daysBetween, deriveRunner, fixHref, type RunnerFacts, type RunnerLetter, type RunnerReport, type RunnerView } from "./runner-model";

const item = (over: Partial<SnapshotItem> = {}): SnapshotItem => ({
  id: over.id ?? "i1",
  status: "to_report",
  amountCents: 77_374,
  dependsOnUnverified: true,
  ddWindowEnd: null,
  reportDueDate: "2026-07-01",
  remitDueDate: "2026-07-01",
  letter: "none",
  draftable: false,
  draftHasProblems: false,
  ...over,
});

const snap = (over: Partial<CloseSnapshot> = {}): CloseSnapshot => ({
  state: "TX",
  asOf: "2026-11-01",
  ruleVersion: "tx-2026.1",
  hasRules: true,
  unverifiedRulePaths: ["interest.rate"],
  pendingRuleChanges: 0,
  items: [item()],
  toReport: { count: 1, cents: 77_374 },
  report: null,
  filingRun: null,
  ...over,
});

const planReport = (status: string, over: Partial<SnapshotReport> = {}): SnapshotReport => ({ id: "r1", status, itemCount: 1, totalCents: 77_374, errorCount: 0, confirmation: null, ...over });
const runnerReport = (status: string, over: Partial<RunnerReport> = {}): RunnerReport => ({
  id: "r1",
  status,
  checksum: "a".repeat(64),
  itemCount: 1,
  totalCents: 77_374,
  errorCount: 0,
  warningCount: 2,
  confirmation: null,
  submittedAt: null,
  approvedBy: null,
  ...over,
});

function facts(s: CloseSnapshot, extra: Partial<Omit<RunnerFacts, "plan" | "late">> = {}): RunnerFacts {
  return {
    plan: deriveClosePlan(s),
    letters: [],
    report: null,
    run: null,
    late: { reportDue: "2026-07-01", reportDueUnverified: true, daysLate: 123, interest: { status: "ok", cents: 2_607, verified: false, ruleVersion: "tx-2026.1" }, remitDue: "2026-07-01" },
    sent: [],
    ddItemCount: s.items.filter((i) => i.status === "dd_pending" || i.status === "dd_sent").length,
    sendMode: "offline",
    unverifiedRuleCount: s.unverifiedRulePaths.length,
    remitOwed: { count: s.items.filter((i) => i.status === "reported").length, totalCents: s.items.filter((i) => i.status === "reported").reduce((a, i) => a + i.amountCents, 0) },
    remittance: null,
    ...extra,
  };
}

const stepOf = (v: RunnerView, id: CloseStepId) => {
  const s = v.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};

describe("close-out runner: TX on a fresh seed (late report, nothing generated)", () => {
  const v = deriveRunner(facts(snap()));

  it("keeps the plan's eight steps in order", () => {
    expect(v.steps.map((s) => s.id)).toEqual(["letters_draft", "letters_approve", "letters_send", "rules_verify", "report_generate", "report_approve", "report_submit", "remit"]);
    // R5-17: the three letter steps are "Not needed" (no item in the window), not "Done", and are not counted.
    expect(v.steps.slice(0, 3).map((s) => s.tone)).toEqual(["not_needed", "not_needed", "not_needed"]);
    expect(v.notNeeded).toBe(3);
    expect(v.total).toBe(5);
    expect(v.done).toBe(0);
  });

  it("R5-17: letters sent this cycle are Done, not Not needed, even after the items left due diligence", () => {
    const sent = [{ outreachId: "o-1", payeeName: "Ravenhill", amountCents: 219_470, offline: true }];
    const w = deriveRunner(facts(snap(), { sent }));
    expect(w.notNeeded).toBe(0);
    expect(w.steps.slice(0, 3).map((s) => s.tone)).not.toContain("not_needed");
  });

  it("R5-17: report steps past their due date are marked late with the days", () => {
    expect(stepOf(v, "report_generate").late).toEqual({ date: "2026-07-01", daysLate: 123 });
    expect(stepOf(v, "remit").late).toEqual({ date: "2026-07-01", daysLate: 123 });
    expect(stepOf(v, "rules_verify").late).toBeNull();
    expect(stepOf(v, "letters_draft").late).toBeNull();
  });

  it("generate is a one-click machine step and is the current step (rules verification does not block it)", () => {
    const g = stepOf(v, "report_generate");
    expect(g.tone).toBe("machine");
    expect(g.control).toMatchObject({ kind: "machine", op: "generate_report" });
    expect(v.currentId).toBe("report_generate");
  });

  it("unverified rule values are a pink human step with a deep link to Rules, never a button", () => {
    const r = stepOf(v, "rules_verify");
    expect(r.tone).toBe("human");
    expect(r.control).toBeNull();
    expect(r.fix).toEqual({ href: "/rules?state=TX", label: "Verify in Rules" });
    expect(r.unverified).toBe(true);
  });

  it("approve and submit are blocked with the real reason; no receipt yet", () => {
    expect(stepOf(v, "report_approve").tone).toBe("blocked");
    expect(stepOf(v, "report_approve").detail).toMatch(/validated report first/);
    expect(stepOf(v, "report_submit").control).toBeNull();
    // Blocked only by an earlier runner step: the fix is the step above, so no link away from the runner.
    expect(stepOf(v, "report_approve").fix).toBeNull();
    expect(stepOf(v, "remit").fix).toBeNull();
    expect(v.receipt).toBeNull();
  });
});

describe("report approval is always a human control", () => {
  it("a current validated file asks a person to approve exactly its checksum", () => {
    const v = deriveRunner(facts(snap({ report: planReport("validated") }), { report: runnerReport("validated") }));
    const a = stepOf(v, "report_approve");
    expect(a.tone).toBe("human");
    // R5-04: the file is shown, and the one unverified rule value needs "approve anyway".
    expect(a.control).toEqual({
      kind: "human",
      op: "approve_report",
      label: "Approve anyway",
      reportId: "r1",
      expectedChecksum: "a".repeat(64),
      file: { itemCount: 1, totalCents: 77_374, checksum: "a".repeat(64), fileHref: "/api/reports/r1/file" },
      unverifiedCount: 1,
      unsentNotices: [],
    });
    expect(a.detail).toMatch(/relies on 1 rule value that is still UNVERIFIED/);
    expect(a.late).toEqual({ date: "2026-07-01", daysLate: 123 });
    expect(v.currentId).toBe("report_approve");
    // The filing agent cannot be started from the runner before that approval.
    const f = stepOf(v, "report_submit");
    expect(f.tone).toBe("blocked");
    expect(f.control).toBeNull();
    // Generate shows the validator result.
    expect(stepOf(v, "report_generate").detail).toMatch(/Validator: no errors, 2 warnings\./);
  });

  it("with every rule verified, approval needs no acknowledgement", () => {
    const v = deriveRunner(facts(snap({ report: planReport("validated"), unverifiedRulePaths: [] }), { report: runnerReport("validated") }));
    expect(stepOf(v, "report_approve").control).toMatchObject({ label: "Approve submission", unverifiedCount: 0 });
  });

  it("a file with validation errors cannot be approved", () => {
    const v = deriveRunner(facts(snap({ report: planReport("awaiting_approval", { errorCount: 1 }) }), { report: runnerReport("awaiting_approval", { errorCount: 1 }) }));
    const a = stepOf(v, "report_approve");
    expect(a.tone).toBe("blocked");
    expect(a.control).toBeNull();
    expect(a.fix?.href).toBe("/reports?state=TX");
  });

  it("no machine control anywhere ever has an approve or send op", () => {
    const all = [
      deriveRunner(facts(snap())),
      deriveRunner(facts(snap({ report: planReport("validated") }), { report: runnerReport("validated") })),
      deriveRunner(facts(snap({ report: planReport("approved") }), { report: runnerReport("approved") })),
    ];
    for (const v of all) {
      for (const s of v.steps) {
        if (s.control?.kind === "machine") expect(["draft_letters", "compose_letters", "generate_report", "run_filing"]).toContain(s.control.op);
        if (s.control && /approve|send/.test(s.control.op)) expect(s.control.kind).toBe("human");
      }
    }
  });
});

describe("filing", () => {
  it("after approval the filing agent is a machine step bound to that report", () => {
    const v = deriveRunner(facts(snap({ report: planReport("approved") }), { report: runnerReport("approved", { approvedBy: "Dana Ruiz" }) }));
    expect(stepOf(v, "report_approve").tone).toBe("done");
    expect(stepOf(v, "report_approve").detail).toMatch(/Approved by Dana Ruiz/);
    expect(stepOf(v, "report_submit").control).toEqual({ kind: "machine", op: "run_filing", label: "Run filing agent", reportId: "r1" });
    expect(v.currentId).toBe("report_submit");
  });

  it("a live run shows as running with no button, and the filmstrip follows it", () => {
    const run = { id: "run1", status: "running", phase: "approved", error: null };
    const v = deriveRunner(facts(snap({ report: planReport("approved"), filingRun: run }), { report: runnerReport("approved"), run }));
    expect(stepOf(v, "report_submit").tone).toBe("running");
    expect(stepOf(v, "report_submit").control).toBeNull();
    expect(v.currentId).toBe("report_submit");
    expect(v.filingRunId).toBe("run1");
    expect(v.filingLive).toBe(true);
  });

  it("a run paused at the portal's approve step is pink (a person must approve)", () => {
    const run = { id: "run1", status: "running", phase: "awaiting_approval", error: null };
    const v = deriveRunner(facts(snap({ report: planReport("awaiting_approval"), filingRun: run }), { report: runnerReport("awaiting_approval"), run }));
    expect(stepOf(v, "report_submit").tone).toBe("human");
    expect(stepOf(v, "report_approve").control?.op).toBe("approve_report");
  });

  it("a failed run on an approved file offers a retry and links to the failed run", () => {
    const run = { id: "run1", status: "failed", phase: null, error: "Portal timed out" };
    const v = deriveRunner(facts(snap({ report: planReport("approved"), filingRun: run }), { report: runnerReport("approved"), run }));
    const s = stepOf(v, "report_submit");
    expect(s.control).toMatchObject({ op: "run_filing", label: "Run filing agent again" });
    expect(s.detail).toMatch(/Portal timed out/);
    expect(s.fix?.href).toBe("/runs/run1");
  });

  it("a submitted report produces the receipt with confirmation, money, lateness and interest", () => {
    const s = snap({ items: [item({ status: "reported" })], toReport: { count: 0, cents: 0 }, report: planReport("submitted", { confirmation: "REPL-TX-1" }) });
    const v = deriveRunner(facts(s, { report: runnerReport("submitted", { confirmation: "REPL-TX-1", approvedBy: "Dana Ruiz", submittedAt: "2026-11-03T10:00:00.000Z" }) }));
    expect(stepOf(v, "report_submit").tone).toBe("done");
    // R5-05: remittance is a human step with its own control, bound to the reported items and total.
    expect(stepOf(v, "remit").tone).toBe("human");
    expect(stepOf(v, "remit").control).toEqual({
      kind: "human",
      op: "record_remittance",
      label: "Record remittance",
      reportId: "r1",
      expectedCount: 1,
      expectedCents: 77_374,
      defaultDate: "2026-11-01",
    });
    expect(stepOf(v, "remit").late).toEqual({ date: "2026-07-01", daysLate: 123 });
    expect(v.receipt).toMatchObject({
      reportId: "r1",
      confirmation: "REPL-TX-1",
      itemCount: 1,
      totalCents: 77_374,
      approvedBy: "Dana Ruiz",
      daysLate: 123,
      interest: { status: "ok", cents: 2_607, verified: false },
      evidenceHref: "/api/reports/r1/evidence",
      remitDue: "2026-07-01",
      remitDueUnverified: true,
      unverifiedRuleCount: 1,
      remittance: null,
    });
  });

  it("after the remittance is recorded the remit step is done, not late, and the receipt carries it", () => {
    const s = snap({ items: [], toReport: { count: 0, cents: 0 }, report: planReport("submitted", { confirmation: "REPL-TX-1" }) });
    const remittance = { remittedOn: "2026-11-01", reference: "WIRE-42", by: "Dana Ruiz", itemCount: 1, totalCents: 77_374 };
    const v = deriveRunner(facts(s, { report: runnerReport("submitted", { confirmation: "REPL-TX-1" }), remittance }));
    const r = stepOf(v, "remit");
    expect(r.tone).toBe("done");
    expect(r.late).toBeNull();
    expect(r.control).toBeNull();
    expect(r.detail).toMatch(/Remitted \$773\.74 for 1 item on Nov 1, 2026, reference WIRE-42/);
    expect(v.receipt?.remittance).toEqual(remittance);
  });
});

describe("letters", () => {
  const dd = [item({ id: "d1", status: "dd_pending", letter: "draft", amountCents: 1_000 }), item({ id: "d2", status: "dd_pending", letter: "draft", amountCents: 2_000 })];
  const letter = (id: string, over: Partial<RunnerLetter> = {}): RunnerLetter => ({
    outreachId: `o-${id}`,
    staleItemId: id,
    status: "draft",
    composed: true,
    ready: true,
    problems: [],
    contentSha256: `h-${id}`,
    payeeName: `Payee ${id}`,
    checkNumber: `10${id.slice(1)}`,
    amountCents: id === "d1" ? 1_000 : 2_000,
    ...over,
  });
  const view = (id: string) => ({ outreachId: `o-${id}`, payeeName: `Payee ${id}`, checkNumber: `10${id.slice(1)}`, amountCents: id === "d1" ? 1_000 : 2_000, previewHref: `/api/outreach/o-${id}/preview`, contentSha256: `h-${id}` });
  const s = snap({ items: dd, toReport: { count: 0, cents: 0 } });

  it("drafting is a machine step when items in the window have no letter", () => {
    const v = deriveRunner(facts(snap({ items: [item({ status: "dd_pending", draftable: true })], toReport: { count: 0, cents: 0 } })));
    expect(stepOf(v, "letters_draft").control).toMatchObject({ kind: "machine", op: "draft_letters" });
    expect(v.currentId).toBe("letters_draft");
  });

  it("uncomposed drafts are composed first (compose all, nothing approved)", () => {
    const v = deriveRunner(facts(s, { letters: [letter("d1", { composed: false, ready: false }), letter("d2")] }));
    expect(stepOf(v, "letters_approve").control).toEqual({ kind: "machine", op: "compose_letters", label: "Compose 1 letter", outreachIds: ["o-d1"], alreadyReady: 1 });
  });

  it("composed ready drafts become a human approval carrying each reviewed hash", () => {
    const v = deriveRunner(facts(s, { letters: [letter("d1"), letter("d2")] }));
    const a = stepOf(v, "letters_approve");
    expect(a.tone).toBe("human");
    expect(a.control).toEqual({
      kind: "human",
      op: "approve_letters",
      label: "Approve 2 letters",
      items: [
        { outreachId: "o-d1", expectedContentSha256: "h-d1" },
        { outreachId: "o-d2", expectedContentSha256: "h-d2" },
      ],
      letters: [view("d1"), view("d2")],
    });
    expect(a.amountCents).toBe(3_000);
    expect(a.count).toBe(2);
  });

  it("R5-03: the approval acts only on the ready letters, names them, and its amount is theirs (not the blocked draft's)", () => {
    const v = deriveRunner(facts(s, { letters: [letter("d1", { ready: false, problems: ["owner mailing address is missing"] }), letter("d2")] }));
    const a = stepOf(v, "letters_approve");
    expect(a.tone).toBe("human");
    expect(a.control).toMatchObject({ label: "Approve 1 letter", letters: [view("d2")], items: [{ outreachId: "o-d2", expectedContentSha256: "h-d2" }] });
    expect(a.amountCents).toBe(2_000);
    expect(a.count).toBe(1);
    expect(a.detail).toMatch(/1 other draft \(Payee d1 \(\$10\.00\)\) needs fixing/);
    expect(a.detail).toMatch(/Read the letter below/);
  });

  it("R5-03: the send label and copy follow the real mode, and a sent letter stays visible", () => {
    const approved = snap({ items: dd.map((i) => ({ ...i, letter: "approved" as const })), toReport: { count: 0, cents: 0 } });
    const letters = [letter("d1", { status: "approved" })];
    const off = stepOf(deriveRunner(facts(approved, { letters, sendMode: "offline" })), "letters_send");
    expect(off.control).toMatchObject({ op: "send_letters", label: "Record 1 letter as sent (offline)", mode: "offline", letters: [view("d1")] });
    expect(off.detail).toMatch(/Offline mode: each letter is recorded as sent and nothing is mailed/);
    expect(off.detail).not.toMatch(/Lob/);
    const none = stepOf(deriveRunner(facts(approved, { letters, sendMode: "not_configured" })), "letters_send");
    expect(none.tone).toBe("blocked");
    expect(none.control).toBeNull();
    const after = stepOf(deriveRunner(facts(s, { letters: [letter("d2", { ready: false })], sent: [{ outreachId: "o-d1", payeeName: "Ravenhill", amountCents: 219_470, offline: true }] })), "letters_send");
    expect(after.detail).toMatch(/Already sent: Ravenhill \(\$2,194\.70\) \(offline, nothing was mailed\)/);
  });

  it("drafts that all have problems are blocked with the first problem and a link to Approvals", () => {
    const v = deriveRunner(facts(s, { letters: [letter("d1", { ready: false, problems: ["Missing address"] }), letter("d2", { ready: false })] }));
    const a = stepOf(v, "letters_approve");
    expect(a.tone).toBe("blocked");
    expect(a.detail).toMatch(/Missing address/);
    expect(a.fix?.href).toBe("/approvals?kind=letter&state=TX");
  });

  it("approved letters are sent by a person (Lob test mode)", () => {
    const approved = snap({ items: dd.map((i) => ({ ...i, letter: "approved" as const })), toReport: { count: 0, cents: 0 } });
    const v = deriveRunner(facts(approved, { letters: [letter("d1", { status: "approved" }), letter("d2", { status: "approved" })], sendMode: "lob_test" }));
    expect(stepOf(v, "letters_send").control).toEqual({
      kind: "human",
      op: "send_letters",
      label: "Send 2 letters (Lob test mode)",
      outreachIds: ["o-d1", "o-d2"],
      letters: [view("d1"), view("d2")],
      mode: "lob_test",
    });
  });
});

describe("helpers", () => {
  it("fixHref scopes page links to the state and keeps pinned links", () => {
    expect(fixHref({ id: "letters_approve", href: "/approvals" }, "ca")).toBe("/approvals?kind=letter&state=CA");
    expect(fixHref({ id: "report_approve", href: "/approvals?sel=r%3Ax" }, "CA")).toBe("/approvals?sel=r%3Ax");
    expect(fixHref({ id: "report_submit", href: "/runs/abc" }, "CA")).toBe("/runs/abc");
  });

  it("daysBetween counts whole UTC days", () => {
    expect(daysBetween("2026-07-01", "2026-11-01")).toBe(123);
    expect(daysBetween("2026-11-01", "2026-11-01")).toBe(0);
  });

  it("is deterministic: same facts, same runner", () => {
    const f = facts(snap({ report: planReport("validated") }), { report: runnerReport("validated") });
    expect(deriveRunner(f)).toEqual(deriveRunner(f));
  });
});

describe("R6: the frozen filing record", () => {
  const record = (over: Partial<FilingRecord> = {}): FilingRecord => ({
    version: 1,
    frozenAt: "2026-11-01T12:00:00.000Z",
    asOf: "2026-11-01",
    state: "TX",
    stage: "annual",
    stageRemits: true,
    nextStage: null,
    itemCount: 1,
    totalCents: 77_374,
    checksum: "a".repeat(64),
    errorCount: 0,
    warningCount: 13,
    reportDue: { date: "2026-07-01", unverified: true },
    daysLate: 123,
    interest: { status: "ok", cents: 2_607, verified: false, ruleVersion: "tx-2026.1" },
    remitDue: { date: "2026-07-01", unverified: true },
    unverifiedRuleCount: 14,
    unverifiedAcknowledged: true,
    unsentNotices: [],
    unsentAcknowledged: false,
    approvedBy: "Dogfood Controller",
    approvedAt: "2026-11-01T12:00:00.000Z",
    approvalId: "a1",
    signIn: "none_configured",
    ...over,
  });
  const noLate = { reportDue: null, reportDueUnverified: false, daysLate: null, interest: { status: "none" as const }, remitDue: null };

  it("R6-01: recording the remittance does not rewrite the filing facts on the receipt", () => {
    // After the remittance the live cycle is empty: nothing late, nothing unverified. The receipt must not follow it.
    const s = snap({ items: [], unverifiedRulePaths: [], toReport: { count: 0, cents: 0 }, report: planReport("submitted", { confirmation: "REPL-TX-1" }) });
    const remittance = { remittedOn: "2026-11-01", reference: "WIRE-DF6-TX", by: "Dogfood Controller", itemCount: 1, totalCents: 77_374 };
    const f = { ...facts(s, { report: runnerReport("submitted", { confirmation: "REPL-TX-1" }), remittance, record: record(), cycleItemCount: 0 }), late: noLate };
    const v = deriveRunner(f);
    expect(v.receipt).toMatchObject({
      frozen: true,
      reportDue: "2026-07-01",
      daysLate: 123,
      interest: { status: "ok", cents: 2_607, verified: false },
      unverifiedRuleCount: 14,
      unverifiedAcknowledged: true,
      approvedBy: "Dogfood Controller",
      warningCount: 13,
      remittance,
    });
    // R6-08: remitted money is not at stake; the header says the cycle closed.
    expect(v.atStakeCents).toBe(0);
    expect(v.remittedCents).toBe(77_374);
    // R6-05: the rules step is grey, never "every rule value is verified".
    const rules = stepOf(v, "rules_verify");
    expect(rules.tone).toBe("not_needed");
    expect(rules.detail).toMatch(/relied on 14 UNVERIFIED rule values, approved anyway/);
    expect(rules.detail).not.toMatch(/is verified/);
  });

  it("R6-05: an empty cycle has nothing to verify and shows the state's real verified count", () => {
    const s = snap({ state: "DE", items: [], unverifiedRulePaths: [], toReport: { count: 0, cents: 0 } });
    const v = deriveRunner(facts(s, { cycleItemCount: 0, ruleTotals: { verified: 0, total: 30 } }));
    const rules = stepOf(v, "rules_verify");
    expect(rules.tone).toBe("not_needed");
    expect(rules.detail).toBe("Nothing to verify this cycle: no DE item is in it. DE rule file: 0 of 30 values verified.");
    expect(v.done).toBe(0);
  });

  it("R6-02: a CA notice filing never offers Record remittance and shows the remit report from the rules", () => {
    const s = snap({
      state: "CA",
      items: [item({ status: "reported", remitDueDate: "2027-06-15", reportDueDate: "2026-11-02" })],
      toReport: { count: 0, cents: 0 },
      report: planReport("submitted", { confirmation: "REPL-CA-1", stageRemits: false, nextStageName: "remit", nextStageVerified: false }),
    });
    const next = { name: "remit", remits: true, due: { date: "2027-06-15", unverified: true } };
    const rec = record({ state: "CA", stage: "notice", stageRemits: false, nextStage: next, remitDue: null, unverifiedRuleCount: 22 });
    const v = deriveRunner(facts(s, { report: runnerReport("submitted", { confirmation: "REPL-CA-1" }), record: rec, stage: { remits: false, next } }));
    const remit = stepOf(v, "remit");
    expect(remit.control).toBeNull();
    expect(remit.tone).toBe("not_needed");
    // R7-01: the scheduled line, the rule file's date only.
    expect(remit.detail).toMatch(/^Scheduled\. Notice filed Nov 1, 2026 · Remit report due Jun 15, 2027 \(UNVERIFIED\).*carries no money/);
    expect(remit.unverified).toBe(true);
    expect(v.receipt).toMatchObject({ stageRemits: false, nextStage: next, unverifiedRuleCount: 22 });
    // The plan (chat card) says the same: no payment is owed with a notice report.
    expect(deriveClosePlan(s).steps.find((x) => x.id === "remit")?.detail).toMatch(/Notice report filed\. Next: the remit report, due Jun 15, 2027 \(UNVERIFIED\)\. The notice report carries no money/);
    // With the cohort's schedule loaded, the plan prints the same scheduled line as the runner.
    const scheduled = { stage: "remit", prior: "notice", noticeReportId: "r1", noticeFiledOn: "2026-11-01", due: { date: "2027-06-15", unverified: true }, opensOn: "2027-06-01", count: 1, cents: 100 };
    expect(deriveClosePlan({ ...s, scheduled }).steps.find((x) => x.id === "remit")?.detail).toMatch(/^Scheduled: Notice filed Nov 1, 2026 · Remit report due Jun 15, 2027 \(UNVERIFIED\)\./);
  });

  it("R6-02: once the remit report date passes, the step is blocked and late, still without a remittance button", () => {
    const s = snap({ state: "CA", asOf: "2027-07-01", items: [item({ status: "reported", remitDueDate: "2027-06-15" })], toReport: { count: 0, cents: 0 }, report: planReport("submitted", { stageRemits: false }) });
    const next = { name: "remit", remits: true, due: { date: "2027-06-15", unverified: true } };
    const v = deriveRunner(facts(s, { report: runnerReport("submitted"), record: record({ stageRemits: false, nextStage: next }), stage: { remits: false, next } }));
    const remit = stepOf(v, "remit");
    expect(remit.tone).toBe("blocked");
    expect(remit.control).toBeNull();
    expect(remit.late).toEqual({ date: "2027-06-15", daysLate: 16 });
  });

  it("R6-09: a notice that never went out is 'Not sent' (pink), never 'Not needed', and the approval must acknowledge it", () => {
    const unsent = [{ staleItemId: "z1", payeeName: "ZINNIA COURT MARKET", amountCents: 280_633, windowClosed: "2029-02-01", reason: "blocked: owner mailing address is missing or incomplete" }];
    const s = snap({ state: "DE", items: [item({ id: "z1", ddWindowEnd: "2029-02-01", amountCents: 280_633 })], toReport: { count: 1, cents: 280_633 }, report: planReport("validated", { totalCents: 280_633 }) });
    const v = deriveRunner(facts(s, { report: runnerReport("validated", { totalCents: 280_633 }), unsent, ddItemCount: 0 }));
    for (const id of ["letters_draft", "letters_approve", "letters_send"] as const) expect(stepOf(v, id).tone).toBe("missed");
    expect(stepOf(v, "letters_send").detail).toMatch(/ZINNIA COURT MARKET \(\$2,806\.33\): blocked: owner mailing address/);
    const a = stepOf(v, "report_approve");
    expect(a.control).toMatchObject({ op: "approve_report", label: "Approve anyway", unsentNotices: unsent });
    expect(a.detail).toMatch(/1 required due-diligence notice for an item in this file was never sent/);
  });

  it("R6-08: at stake counts reported money until it is remitted", () => {
    const s = snap({ items: [item({ status: "reported" }), item({ id: "o1", status: "dd_pending", amountCents: 1_000 })], report: planReport("submitted") });
    expect(deriveClosePlan(s).atStakeCents).toBe(78_374);
    const after = snap({ items: [item({ id: "o1", status: "dd_pending", amountCents: 1_000 })], report: planReport("submitted") });
    expect(deriveClosePlan(after).atStakeCents).toBe(1_000);
  });
});
