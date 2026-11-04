/**
 * "Close out <STATE>": the ordered checklist for one state's cycle, derived DETERMINISTICALLY from a data snapshot.
 * Pure: no I/O, no clock reads, no model. Every date here was computed by the rules engine and stored on the item;
 * this module only orders, counts, sums and words them. It never decides the law.
 *
 * Status vocabulary: done | ready (the card may run it: drafts or a validated file, nothing leaves the app) |
 * running (an agent is working) | needs_approval (a person acts at an in-app gate) | blocked (with a reason).
 * Approving, sending, submitting and paying are only ever needs_approval: they link to the human gate.
 */
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import { formatUSD } from "@/lib/money";
import type { ClosePlan, CloseStep, CloseStepId } from "@/lib/chat/ui-types";

export const CLOSE_OUT_STATES = { CA: "California", DE: "Delaware", TX: "Texas" } as const;
export type CloseOutState = keyof typeof CLOSE_OUT_STATES;

export const isCloseOutState = (s: string): s is CloseOutState => Object.hasOwn(CLOSE_OUT_STATES, s);

/** Best letter on file for an item: none, a draft (awaiting a person), approved but unsent, or sent. */
export type LetterState = "none" | "draft" | "approved" | "sent";

export interface SnapshotItem {
  id: string;
  status: "dd_pending" | "dd_sent" | "owner_responded" | "to_report" | "reported" | "remitted";
  amountCents: number;
  dependsOnUnverified: boolean;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
  letter: LetterState;
  /** A new letter draft may be made for it (same rule as bulk drafting). */
  draftable: boolean;
  /** Its letter draft has readiness problems a person must fix before approving. */
  draftHasProblems: boolean;
}

export interface SnapshotReport {
  id: string;
  status: string;
  itemCount: number;
  totalCents: number;
  errorCount: number;
  confirmation: string | null;
  /** R6-02: whether the report's stage carries money (rule file includesRemittance); null/absent = unknown. */
  stageRemits?: boolean | null;
  /** The stage after this one, from the rule file (CA notice -> remit). */
  nextStageName?: string | null;
  /** That stage's rule (dueRule) is verified. */
  nextStageVerified?: boolean;
}

export interface CloseSnapshot {
  state: CloseOutState;
  asOf: string;
  ruleVersion: string | null;
  /** False when the state has no loadable rule file (every date UNKNOWN). */
  hasRules: boolean;
  /** Unverified rule values that apply to the property types in this cycle. */
  unverifiedRulePaths: string[];
  pendingRuleChanges: number;
  items: SnapshotItem[];
  /** Live "To Report" pool for the state. */
  toReport: { count: number; cents: number };
  /** The current cycle's report, if any. */
  report: SnapshotReport | null;
  /** Latest filing-agent run for that report. */
  filingRun: { id: string; status: string; phase: string | null; error: string | null } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Dec 1, 2026" from YYYY-MM-DD, no timezone drift. */
export function fmtIso(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : iso;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const sum = (items: readonly SnapshotItem[]) => items.reduce((s, i) => s + i.amountCents, 0);
const minDate = (dates: (string | null)[]) => dates.filter((d): d is string => !!d).sort()[0] ?? null;
const anyUnverified = (items: readonly SnapshotItem[]) => items.some((i) => i.dependsOnUnverified);

const LOCKED = new Set(["submitted", "confirmed"]);
const HELD = new Set(["awaiting_approval", "approved"]);

type StepInput = Omit<CloseStep, "blockedReason" | "action" | "unverified"> &
  Partial<Pick<CloseStep, "blockedReason" | "action" | "unverified">>;

const step = (s: StepInput): CloseStep => ({ blockedReason: null, action: null, unverified: false, ...s });
const blocked = (s: Omit<StepInput, "status" | "blockedReason" | "detail">, reason: string): CloseStep =>
  step({ ...s, status: "blocked", detail: reason, blockedReason: reason });

interface Ctx {
  snap: CloseSnapshot;
  st: CloseOutState;
  dd: {
    all: SnapshotItem[];
    needDraft: SnapshotItem[];
    /** In the window with only a cancelled or failed letter: a person must re-draft it. */
    stuck: SnapshotItem[];
    drafts: SnapshotItem[];
    approved: SnapshotItem[];
    sent: SnapshotItem[];
  };
  report: SnapshotReport | null;
  locked: boolean;
  /** The current report matches the live To Report pool (or is locked, when the pool legitimately empties). */
  current: boolean;
}

function lettersDraft({ st, dd }: Ctx): CloseStep {
  const base = { id: "letters_draft" as const, title: "Draft due-diligence letters", href: `/items?state=${st}&status=dd_pending`, linkLabel: "Open the items" };
  if (dd.all.length === 0) {
    return step({ ...base, status: "done", detail: `No ${st} item is inside its due-diligence window right now.`, amountCents: null, count: 0 });
  }
  if (dd.needDraft.length > 0) {
    const batch = Math.min(dd.needDraft.length, BULK_MAX);
    return step({
      ...base,
      status: "ready",
      detail: `${n(dd.needDraft.length, "item")} in the due-diligence window ${dd.needDraft.length === 1 ? "has" : "have"} no letter yet.`,
      amountCents: sum(dd.needDraft),
      count: dd.needDraft.length,
      unverified: anyUnverified(dd.needDraft),
      action: { kind: "draft_letters", label: batch < dd.needDraft.length ? `Draft ${batch} of ${dd.needDraft.length} letters` : `Draft ${n(batch, "letter")}` },
    });
  }
  const { stuck } = dd;
  if (stuck.length > 0) {
    return blocked(
      { ...base, amountCents: sum(stuck), count: stuck.length },
      `${n(stuck.length, "item")} only ${stuck.length === 1 ? "has" : "have"} a cancelled or failed letter. Re-draft from the item.`,
    );
  }
  return step({ ...base, status: "done", detail: `Every item in the window has a letter drafted or sent (${n(dd.all.length, "item")}).`, amountCents: sum(dd.all), count: dd.all.length });
}

function lettersApprove({ dd }: Ctx): CloseStep {
  const base = { id: "letters_approve" as const, title: "Approve the letters", href: "/approvals", linkLabel: "Review in Approvals" };
  if (dd.drafts.length > 0) {
    const problems = dd.drafts.filter((i) => i.draftHasProblems);
    if (problems.length > 0) {
      return blocked(
        { ...base, amountCents: sum(problems), count: problems.length },
        `${n(problems.length, "draft")} ${problems.length === 1 ? "has" : "have"} problems to fix before approval.`,
      );
    }
    return step({
      ...base,
      status: "needs_approval",
      detail: `${n(dd.drafts.length, "letter draft")} ${dd.drafts.length === 1 ? "waits" : "wait"} for your approval.`,
      amountCents: sum(dd.drafts),
      count: dd.drafts.length,
    });
  }
  const undrafted = [...dd.needDraft, ...dd.stuck];
  if (undrafted.length > 0) return blocked({ ...base, amountCents: sum(undrafted), count: undrafted.length }, "Draft the letters first.");
  return step({ ...base, status: "done", detail: dd.all.length ? "No letter is waiting for approval." : "No letters are needed this cycle.", amountCents: null, count: 0 });
}

function lettersSend({ dd }: Ctx): CloseStep {
  const base = { id: "letters_send" as const, title: "Send the letters", href: "/approvals", linkLabel: "Send from Approvals" };
  if (dd.approved.length > 0) {
    return step({
      ...base,
      status: "needs_approval",
      detail: `${n(dd.approved.length, "approved letter")} ${dd.approved.length === 1 ? "is" : "are"} ready for you to send (Lob TEST mode, nothing is mailed).`,
      amountCents: sum(dd.approved),
      count: dd.approved.length,
    });
  }
  const waiting = [...dd.drafts, ...dd.needDraft, ...dd.stuck];
  if (waiting.length > 0) {
    return blocked({ ...base, amountCents: sum(waiting), count: waiting.length }, "Letters can be sent only after you approve them.");
  }
  if (dd.all.length === 0) return step({ ...base, status: "done", detail: "No letters are needed this cycle.", amountCents: null, count: 0 });
  return step({ ...base, status: "done", detail: `${n(dd.sent.length, "letter")} sent.`, amountCents: sum(dd.sent), count: dd.sent.length });
}

function rulesVerify({ snap, st }: Ctx): CloseStep {
  const base = { id: "rules_verify" as const, title: "Verify the rules this report relies on", href: `/rules?state=${st}`, linkLabel: "Verify in Rules" };
  const affected = snap.items.filter((i) => i.dependsOnUnverified);
  if (!snap.hasRules) return blocked({ ...base, amountCents: null, count: null, unverified: true }, `No rule file for ${st}, so its dates are UNKNOWN.`);
  const u = snap.unverifiedRulePaths.length;
  const p = snap.pendingRuleChanges;
  if (u === 0 && p === 0) {
    // R6-05: with no item in the cycle nothing relies on a rule value; never call that "verified".
    const detail = snap.items.length === 0 ? `Nothing to verify this cycle: no ${st} item is in it.` : "Every rule value this cycle relies on is verified.";
    return step({ ...base, status: "done", detail, amountCents: null, count: 0 });
  }
  const parts = [u ? `${n(u, "rule value")} this cycle relies on ${u === 1 ? "is" : "are"} UNVERIFIED` : null, p ? `${n(p, "rule change")} ${p === 1 ? "awaits" : "await"} review` : null];
  return step({
    ...base,
    status: "needs_approval",
    detail: `${parts.filter(Boolean).join("; ")}. Only a person can verify them.`,
    // Money and count are the items whose engine dates depend on an unverified value (the rule-value count is in the detail).
    amountCents: affected.length ? sum(affected) : null,
    count: affected.length || null,
    unverified: u > 0,
  });
}

function reportGenerate({ snap, st, report, locked, current }: Ctx): CloseStep {
  const base = { id: "report_generate" as const, title: "Generate and validate the report", href: `/reports?state=${st}`, linkLabel: "Open in Reports" };
  const pool = snap.toReport;
  const unverified = anyUnverified(snap.items.filter((i) => i.status === "to_report"));
  if (report && (locked || HELD.has(report.status) || (report.status === "validated" && current))) {
    // A person holds this exact file; items that reached To Report after it was made are not in it (never regenerated here).
    const late = !locked && !current && pool.count > report.itemCount ? pool.count - report.itemCount : 0;
    return step({
      ...base,
      status: "done",
      detail: `Validated NAUPA file: ${n(report.itemCount, "item")}, ${formatUSD(report.totalCents)}.${late ? ` ${n(late, "item")} reached To Report after it was made and ${late === 1 ? "is" : "are"} not in it.` : ""}`,
      amountCents: report.totalCents,
      count: report.itemCount,
    });
  }
  if (report?.status === "validated" && snap.filingRun?.status === "running") {
    return blocked({ ...base, amountCents: report.totalCents, count: report.itemCount }, "Out of date, but the filing agent is working on this file. Regenerating would replace it; wait for the run to finish.");
  }
  if (report?.status === "validated") {
    return step({
      ...base,
      status: "ready",
      detail: `Out of date: ${n(pool.count, "item")} ${pool.count === 1 ? "is" : "are"} To Report now, the file has ${report.itemCount}.`,
      amountCents: pool.cents,
      count: pool.count,
      unverified,
      action: { kind: "generate_report", label: "Regenerate and validate" },
    });
  }
  if (report?.status === "draft") {
    return blocked(
      { ...base, amountCents: report.totalCents, count: report.itemCount, unverified },
      `The last file has ${n(report.errorCount, "validation error")}. Fix ${report.errorCount === 1 ? "it" : "them"} in Reports, then regenerate.`,
    );
  }
  if (pool.count > 0) {
    return step({
      ...base,
      status: "ready",
      detail: `${n(pool.count, "item")} ${pool.count === 1 ? "is" : "are"} To Report (${formatUSD(pool.cents)}) and no validated file exists yet.`,
      amountCents: pool.cents,
      count: pool.count,
      unverified,
      action: { kind: "generate_report", label: "Generate and validate" },
    });
  }
  const nextClose = minDate(snap.items.filter((i) => i.status === "dd_pending" || i.status === "dd_sent" || i.status === "owner_responded").map((i) => i.ddWindowEnd).filter((d) => d !== null && d >= snap.asOf));
  return blocked(
    { ...base, amountCents: null, count: 0 },
    `No ${st} items are To Report yet.${nextClose ? ` The earliest due-diligence window closes ${fmtIso(nextClose)}.` : ""}`,
  );
}

function reportApprove({ st, report, locked, current }: Ctx): CloseStep {
  const base = { id: "report_approve" as const, title: "Approve the submission", amountCents: report?.totalCents ?? null, count: report?.itemCount ?? null };
  const gate = report ? `/approvals?sel=${encodeURIComponent(`r:${report.id}`)}` : "/approvals";
  if (report && (locked || report.status === "approved")) {
    return step({ ...base, status: "done", detail: "You approved this exact file for submission.", href: gate, linkLabel: "Open in Approvals" });
  }
  if (report?.status === "awaiting_approval") {
    return step({ ...base, status: "needs_approval", detail: "The file waits for your approval. Nothing is submitted until you approve it.", href: gate, linkLabel: "Approve in Approvals" });
  }
  if (report?.status === "validated" && current) {
    return step({ ...base, status: "needs_approval", detail: "The validated file is ready for your review and approval.", href: `/reports?state=${st}`, linkLabel: "Review in Reports" });
  }
  return blocked({ ...base, href: "/approvals", linkLabel: "Open Approvals" }, "Needs a current, validated report first.");
}

function reportSubmit({ snap, st, report, locked, current }: Ctx): CloseStep {
  const base = { id: "report_submit" as const, title: "Submit on the replica portal", href: `/reports?state=${st}`, linkLabel: "File from Reports", amountCents: report?.totalCents ?? null, count: report?.itemCount ?? null };
  const run = snap.filingRun;
  if (report && locked) {
    return step({ ...base, status: "done", detail: `Submitted to the replica ${st} portal${report.confirmation ? `, confirmation ${report.confirmation}` : ""}.` });
  }
  if (run?.status === "running") {
    const paused = run.phase === "awaiting_approval";
    return step({
      ...base,
      status: paused ? "needs_approval" : "running",
      detail: paused ? "The filing agent is paused at 'Approve submission'. Nothing is submitted yet." : "The filing agent is filling the replica portal form.",
      href: `/runs/${run.id}`,
      linkLabel: "Watch the run",
    });
  }
  if (run?.status === "failed" && report && (HELD.has(report.status) || report.status === "validated")) {
    return blocked({ ...base, href: `/runs/${run.id}`, linkLabel: "Open the run" }, `The last filing run failed${run.error ? `: ${run.error.slice(0, 160)}` : "."} Check it, then start it again from Reports.`);
  }
  if (report && (HELD.has(report.status) || (report.status === "validated" && current))) {
    return step({ ...base, status: "needs_approval", detail: "You start the filing agent from Reports. It stops before submitting unless you have approved this file." });
  }
  return blocked(base, "Needs a current, validated report first.");
}

function remit({ snap, st, report, locked }: Ctx): CloseStep {
  const owed = snap.items.filter((i) => i.status === "to_report" || i.status === "reported");
  const due = minDate(owed.map((i) => i.remitDueDate));
  const dueText = owed.length ? (due ? ` Due ${fmtIso(due)}${anyUnverified(owed) ? " (UNVERIFIED)" : ""}.` : " Due date UNKNOWN: a rule value is missing.") : "";
  const base = { id: "remit" as const, title: "Remit to the state", href: `/items?state=${st}&status=reported`, linkLabel: "Open reported items", amountCents: owed.length ? sum(owed) : null, count: owed.length, unverified: anyUnverified(owed) };
  if (locked && report?.stageRemits === false) {
    // R6-02: a notice-only filing carries no money; remittance goes with the next stage's report (rule file dates only).
    const filed = owed.filter((i) => i.status === "reported");
    const next = minDate(filed.map((i) => i.remitDueDate));
    const unverified = anyUnverified(filed) || report.nextStageVerified === false;
    const stage = report.nextStageName ?? "remit";
    const when = next ? `due ${fmtIso(next)}${unverified ? " (UNVERIFIED)" : ""}` : "due date UNKNOWN: a rule value is missing";
    return blocked(
      { ...base, amountCents: filed.length ? sum(filed) : null, count: filed.length, unverified },
      `Notice report filed; it carries no money. Next: the ${stage} report, ${when}. Remittance goes with that report.`,
    );
  }
  if (locked) {
    const unpaid = owed.filter((i) => i.status === "reported");
    if (unpaid.length === 0) return step({ ...base, status: "done", detail: "Nothing left to remit for this cycle.", amountCents: null, count: 0 });
    return step({
      ...base,
      amountCents: sum(unpaid),
      count: unpaid.length,
      status: "needs_approval",
      detail: `Pay ${formatUSD(sum(unpaid))} to ${st} for ${n(unpaid.length, "reported item")} not yet remitted.${dueText} Payment happens outside this app; nothing is paid from here.`,
    });
  }
  if (!report && owed.length === 0) return blocked(base, "Nothing is due to remit until items reach To Report.");
  return blocked(base, `Remittance follows the submitted report.${dueText}`);
}

/** The whole plan, in order. Same snapshot in, same plan out. */
export function deriveClosePlan(snap: CloseSnapshot): ClosePlan {
  const st = snap.state;
  const ddAll = snap.items.filter((i) => i.status === "dd_pending" || i.status === "dd_sent");
  const pending = ddAll.filter((i) => i.status === "dd_pending");
  const report = snap.report;
  const locked = !!report && LOCKED.has(report.status);
  const current = !!report && (locked || (report.itemCount === snap.toReport.count && report.totalCents === snap.toReport.cents));
  const ctx: Ctx = {
    snap,
    st,
    report,
    locked,
    current,
    dd: {
      all: ddAll,
      needDraft: pending.filter((i) => i.draftable),
      stuck: pending.filter((i) => !i.draftable && i.letter === "none"),
      drafts: pending.filter((i) => i.letter === "draft"),
      approved: pending.filter((i) => i.letter === "approved"),
      sent: ddAll.filter((i) => i.status === "dd_sent" || i.letter === "sent"),
    },
  };
  const steps = [lettersDraft, lettersApprove, lettersSend, rulesVerify, reportGenerate, reportApprove, reportSubmit, remit].map((f) => f(ctx));
  const open = snap.items.filter((i) => i.status !== "reported" && i.status !== "remitted");
  const nextStepId: CloseStepId | null = steps.find((s) => s.status === "ready" || s.status === "needs_approval")?.id ?? null;
  return {
    state: st,
    stateName: CLOSE_OUT_STATES[st],
    asOf: snap.asOf,
    ruleVersion: snap.ruleVersion,
    steps,
    done: steps.filter((s) => s.status === "done").length,
    total: steps.length,
    nextStepId,
    // R6-08: money still owed to the state. Reported items count until remitted; remitted money is not at stake.
    atStakeCents: sum(open) + sum(snap.items.filter((i) => i.status === "reported")),
    itemCount: open.length + snap.items.filter((i) => i.status === "reported").length,
    reportDue: open.length ? { date: minDate(open.map((i) => i.reportDueDate)), unverified: anyUnverified(open) } : null,
    remitDue: snap.items.length ? { date: minDate(snap.items.filter((i) => i.status !== "remitted").map((i) => i.remitDueDate)), unverified: anyUnverified(snap.items) } : null,
  };
}
