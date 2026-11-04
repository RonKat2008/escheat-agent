/**
 * The close-out RUNNER's step-state machine: the same 8 steps as the guided plan (derive.ts), each turned into the one
 * control the runner page may show for it. Pure: no I/O, no clock reads, no model. It never decides the law and it
 * never approves anything: an approval is always a `human` control that needs a typed approver name, and the server
 * re-checks it (session + approver + reviewed hash) on the approve routes.
 *
 * Tones: done | not_needed (grey: nothing to do this cycle; not counted as done, R5-17) | machine (one click runs a
 * reversible step: drafts, compose, generate+validate, start the filing agent AFTER a person approved) | human (pink: a
 * person must act; approvals, sending letters, verifying rules, recording a remittance) | running (the filing agent is
 * working) | blocked (with the real reason and, where there is one, a link to fix it).
 *
 * R5-03: every letter approval and send lists the exact letters it acts on (payee, check #, amount, preview, hash) and
 * its label, count and amount are those letters. The send label names the real send mode (offline vs Lob test).
 * R5-04: the report approval shows the file and, when rules are unverified, needs an explicit "approve anyway".
 * R5-05: after filing, "Record remittance" is a human step that moves the reported items to Remitted.
 */
import type { ClosePlan, CloseStep, CloseStepId } from "@/lib/chat/ui-types";
import { formatUSD } from "@/lib/money";
import type { StateInterest } from "@/lib/reports/late-money";
import { fmtIso } from "./derive";

export interface RunnerLetter {
  outreachId: string;
  staleItemId: string;
  status: "draft" | "awaiting_approval" | "approved";
  composed: boolean;
  ready: boolean;
  problems: string[];
  /** outreachContentSha256 of the current draft: what the reviewer approves. */
  contentSha256: string;
  payeeName: string;
  checkNumber: string | null;
  amountCents: number;
}

/** A letter of this cycle that already went out (or was recorded as sent offline). */
export interface RunnerSentLetter {
  outreachId: string;
  payeeName: string;
  amountCents: number;
  /** True when it was recorded offline: nothing was mailed. */
  offline: boolean;
}

/** How a send would really go right now (server env): offline records only, Lob test mode, or no Lob key at all. */
export type SendMode = "offline" | "lob_test" | "not_configured";

export interface RunnerReport {
  id: string;
  status: string;
  checksum: string | null;
  itemCount: number;
  totalCents: number;
  errorCount: number;
  warningCount: number;
  confirmation: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
}

export interface RunnerRun {
  id: string;
  status: string;
  phase: string | null;
  error: string | null;
}

export interface RunnerLate {
  /** Earliest engine-computed report due date of the items in this cycle's report (or To Report pool). */
  reportDue: string | null;
  reportDueUnverified: boolean;
  /** Whole days between the report due date and the demo-clock date; null when not late or unknown. */
  daysLate: number | null;
  /** Late interest from the shared late-money helper (rules engine). `none` = nothing late. */
  interest: StateInterest;
  /** Earliest engine-computed remit due date of items still owed to the state (To Report or reported). */
  remitDue?: string | null;
}

/** What a recorded remittance said (R5-05). */
export interface RunnerRemittance {
  remittedOn: string;
  reference: string | null;
  by: string;
  itemCount: number;
  totalCents: number;
}

export interface RunnerFacts {
  plan: ClosePlan;
  letters: RunnerLetter[];
  report: RunnerReport | null;
  run: RunnerRun | null;
  late: RunnerLate;
  /** Letters of this cycle already sent (offline or Lob test). */
  sent?: RunnerSentLetter[];
  /** Items in this cycle's due-diligence window (pending or sent). 0 = no letter is needed this cycle. */
  ddItemCount?: number;
  sendMode?: SendMode;
  /** Unverified rule values the cycle's file relies on (same count as the rules step). */
  unverifiedRuleCount?: number;
  /** Reported items not yet remitted (after filing). */
  remitOwed?: { count: number; totalCents: number };
  /** The remittance recorded for this cycle's report, if any. */
  remittance?: RunnerRemittance | null;
}

/** One letter as the approve and send steps list it. */
export interface RunnerLetterView {
  outreachId: string;
  payeeName: string;
  checkNumber: string | null;
  amountCents: number;
  /** The stored draft, exactly as composed (GET /api/outreach/:id/preview). */
  previewHref: string;
  contentSha256: string;
}

export interface ReportFileView {
  itemCount: number;
  totalCents: number;
  checksum: string;
  fileHref: string;
}

export type MachineControl =
  | { kind: "machine"; op: "draft_letters"; label: string }
  | { kind: "machine"; op: "compose_letters"; label: string; outreachIds: string[] }
  | { kind: "machine"; op: "generate_report"; label: string }
  | { kind: "machine"; op: "run_filing"; label: string; reportId: string };

export type HumanControl =
  | { kind: "human"; op: "approve_letters"; label: string; items: { outreachId: string; expectedContentSha256: string }[]; letters: RunnerLetterView[] }
  | { kind: "human"; op: "send_letters"; label: string; outreachIds: string[]; letters: RunnerLetterView[]; mode: SendMode }
  | { kind: "human"; op: "approve_report"; label: string; reportId: string; expectedChecksum: string; file: ReportFileView; unverifiedCount: number }
  | { kind: "human"; op: "record_remittance"; label: string; reportId: string; expectedCount: number; expectedCents: number; defaultDate: string };

export type RunnerControl = MachineControl | HumanControl;
export type RunnerOp = RunnerControl["op"];
export type RunnerTone = "done" | "not_needed" | "machine" | "human" | "running" | "blocked";

export interface RunnerStep {
  id: CloseStepId;
  title: string;
  tone: RunnerTone;
  detail: string;
  amountCents: number | null;
  count: number | null;
  unverified: boolean;
  /** The one thing the runner page can do for this step (null: nothing to do here). */
  control: RunnerControl | null;
  /** Where a person fixes or completes it elsewhere in the app (blocked reasons, rule verification). */
  fix: { href: string; label: string } | null;
  /** R5-17: the step's deadline has passed and the step is not done. */
  late: { date: string; daysLate: number } | null;
}

export interface RunnerReceipt {
  reportId: string;
  confirmation: string | null;
  itemCount: number;
  totalCents: number;
  submittedAt: string | null;
  approvedBy: string | null;
  reportDue: string | null;
  reportDueUnverified: boolean;
  daysLate: number | null;
  interest: StateInterest;
  remitDue: string | null;
  remitDueUnverified: boolean;
  evidenceHref: string;
  fileHref: string;
  /** R5-04: unverified rule values the filed file relies on. */
  unverifiedRuleCount: number;
  /** R5-05: the recorded remittance, once there is one. */
  remittance: RunnerRemittance | null;
}

export interface RunnerView {
  state: string;
  stateName: string;
  asOf: string;
  ruleVersion: string | null;
  atStakeCents: number;
  itemCount: number;
  steps: RunnerStep[];
  /** Steps done (not_needed steps are not counted). */
  done: number;
  /** Steps that apply this cycle (all steps minus not_needed). */
  total: number;
  notNeeded: number;
  /** The step the runner points at: the first one this page can act on (or the running one). */
  currentId: CloseStepId | null;
  /** The filing run to show live (running), or the last one (for its filmstrip). */
  filingRunId: string | null;
  filingLive: boolean;
  receipt: RunnerReceipt | null;
}

const LOCKED = new Set(["submitted", "confirmed"]);
const LETTER_STEPS = new Set<CloseStepId>(["letters_draft", "letters_approve", "letters_send"]);
const REPORT_STEPS = new Set<CloseStepId>(["report_generate", "report_approve", "report_submit"]);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const sumCents = (xs: readonly { amountCents: number }[]) => xs.reduce((a, x) => a + x.amountCents, 0);

/** Where a step's own link goes, pre-filtered to the state (mirrors the chat card's closeStepHref). */
export function fixHref(step: Pick<CloseStep, "id" | "href">, state: string): string {
  const [path = "/", query = ""] = step.href.split("?");
  const params = new URLSearchParams(query);
  if (params.has("sel") || path.startsWith("/runs/")) return step.href;
  if (path === "/approvals" && (step.id === "letters_approve" || step.id === "letters_send") && !params.has("kind")) params.set("kind", "letter");
  if (!params.has("state")) params.set("state", state.toUpperCase());
  return `${path}?${params.toString()}`;
}

/** A step blocked only by an EARLIER step of this runner: the fix is above, not a link elsewhere. */
const waitingOnEarlier = (s: RunnerStep): RunnerStep => (s.tone === "blocked" ? { ...s, fix: null } : s);

const base = (s: CloseStep) => ({ id: s.id, title: s.title, detail: s.detail, amountCents: s.amountCents, count: s.count, unverified: s.unverified, late: null });

function fromPlan(s: CloseStep, state: string): RunnerStep {
  if (s.status === "done") return { ...base(s), tone: "done", control: null, fix: null };
  if (s.status === "running") return { ...base(s), tone: "running", control: null, fix: null };
  if (s.status === "blocked") return { ...base(s), tone: "blocked", control: null, fix: { href: fixHref(s, state), label: s.linkLabel } };
  return { ...base(s), tone: "human", control: null, fix: { href: fixHref(s, state), label: s.linkLabel } };
}

export const letterView = (l: Pick<RunnerLetter, "outreachId" | "payeeName" | "checkNumber" | "amountCents" | "contentSha256">): RunnerLetterView => ({
  outreachId: l.outreachId,
  payeeName: l.payeeName,
  checkNumber: l.checkNumber,
  amountCents: l.amountCents,
  previewHref: `/api/outreach/${l.outreachId}/preview`,
  contentSha256: l.contentSha256,
});

/** "Ravenhill Supply ($2,194.70)" for up to three letters, then "and N more". */
function names(xs: readonly { payeeName: string; amountCents: number }[]): string {
  const shown = xs.slice(0, 3).map((x) => `${x.payeeName} (${formatUSD(x.amountCents)})`);
  return xs.length > 3 ? `${shown.join(", ")} and ${xs.length - 3} more` : shown.join(", ");
}

function lettersDraft(s: CloseStep, state: string): RunnerStep {
  if (s.action?.kind === "draft_letters") return { ...base(s), tone: "machine", control: { kind: "machine", op: "draft_letters", label: s.action.label }, fix: null };
  return fromPlan(s, state);
}

function lettersApprove(s: CloseStep, f: RunnerFacts): RunnerStep {
  const st = f.plan.state;
  const drafts = f.letters.filter((l) => l.status !== "approved");
  if (s.status === "done" || drafts.length === 0) return fromPlan(s, st);
  const uncomposed = drafts.filter((l) => !l.composed);
  if (uncomposed.length > 0) {
    return {
      ...base(s),
      tone: "machine",
      detail: `${n(uncomposed.length, "letter draft")} ${uncomposed.length === 1 ? "is" : "are"} not composed yet: ${names(uncomposed)}. Composing writes the notice and checks the required language; nothing is approved or sent.`,
      amountCents: sumCents(uncomposed),
      count: uncomposed.length,
      control: { kind: "machine", op: "compose_letters", label: `Compose ${n(uncomposed.length, "letter")}`, outreachIds: uncomposed.map((l) => l.outreachId) },
      fix: null,
    };
  }
  const ready = drafts.filter((l) => l.ready);
  const problems = drafts.filter((l) => !l.ready);
  const fix = { href: fixHref(s, st), label: "Fix in Approvals" };
  if (ready.length === 0) {
    const first = problems[0]?.problems[0];
    return {
      ...base(s),
      tone: "blocked",
      detail: `${n(problems.length, "draft")} cannot be approved yet (${names(problems)})${first ? `: ${first}` : "."}`,
      amountCents: sumCents(problems),
      count: problems.length,
      control: null,
      fix,
    };
  }
  const other = problems.length ? ` ${n(problems.length, "other draft")} (${names(problems)}) ${problems.length === 1 ? "needs" : "need"} fixing in Approvals first and ${problems.length === 1 ? "is" : "are"} not part of this approval.` : "";
  return {
    ...base(s),
    tone: "human",
    detail: `Read ${ready.length === 1 ? "the letter" : `each of the ${ready.length} letters`} below, exactly as ${ready.length === 1 ? "it" : "they"} will go out, then approve.${other} Nothing is sent when you approve.`,
    amountCents: sumCents(ready),
    count: ready.length,
    control: {
      kind: "human",
      op: "approve_letters",
      label: `Approve ${n(ready.length, "letter")}`,
      items: ready.map((l) => ({ outreachId: l.outreachId, expectedContentSha256: l.contentSha256 })),
      letters: ready.map(letterView),
    },
    fix: problems.length ? fix : null,
  };
}

const MODE_COPY: Record<SendMode, string> = {
  offline: "Offline mode: each letter is recorded as sent and nothing is mailed.",
  lob_test: "Lob test mode: Lob renders each letter and nothing is mailed.",
  not_configured: "No Lob test key is configured and offline mode is off, so letters cannot be sent.",
};

function sendLabel(count: number, mode: SendMode): string {
  return mode === "offline" ? `Record ${n(count, "letter")} as sent (offline)` : `Send ${n(count, "letter")} (Lob test mode)`;
}

function sentNote(sent: readonly RunnerSentLetter[]): string {
  if (sent.length === 0) return "";
  const offline = sent.every((x) => x.offline);
  return ` Already sent: ${names(sent)}${offline ? " (offline, nothing was mailed)" : ""}.`;
}

function lettersSend(s: CloseStep, f: RunnerFacts): RunnerStep {
  const approved = f.letters.filter((l) => l.status === "approved");
  const mode = f.sendMode ?? "lob_test";
  const sent = f.sent ?? [];
  if (s.status === "needs_approval" && approved.length > 0) {
    if (mode === "not_configured") {
      return { ...base(s), tone: "blocked", detail: `${n(approved.length, "approved letter")} (${names(approved)}) cannot be sent. ${MODE_COPY[mode]}`, amountCents: sumCents(approved), count: approved.length, control: null, fix: { href: "/settings/integrations", label: "Open integrations" } };
    }
    return {
      ...base(s),
      tone: "human",
      detail: `${n(approved.length, "approved letter")} ${approved.length === 1 ? "is" : "are"} ready to send. ${MODE_COPY[mode]}${sentNote(sent)}`,
      amountCents: sumCents(approved),
      count: approved.length,
      control: { kind: "human", op: "send_letters", label: sendLabel(approved.length, mode), outreachIds: approved.map((l) => l.outreachId), letters: approved.map(letterView), mode },
      fix: null,
    };
  }
  const step = fromPlan(s, f.plan.state);
  if (sent.length === 0) return step;
  // R5-03: a letter that went out stays visible on the step, even while other drafts still wait.
  return { ...step, detail: `${step.detail}${sentNote(sent)}` };
}

function reportGenerate(s: CloseStep, f: RunnerFacts): RunnerStep {
  if (s.action?.kind === "generate_report") return { ...base(s), tone: "machine", control: { kind: "machine", op: "generate_report", label: s.action.label }, fix: null };
  const step = fromPlan(s, f.plan.state);
  const r = f.report;
  if (step.tone === "done" && r) {
    const v = r.errorCount === 0 ? `Validator: no errors${r.warningCount ? `, ${n(r.warningCount, "warning")}` : ""}.` : `Validator: ${n(r.errorCount, "error")}.`;
    return { ...step, detail: `${s.detail} ${v}` };
  }
  return step;
}

function reportApprove(s: CloseStep, f: RunnerFacts): RunnerStep {
  const r = f.report;
  const st = f.plan.state;
  if (s.status === "done") {
    return { ...fromPlan(s, st), detail: r?.approvedBy ? `Approved by ${r.approvedBy} for this exact file (checksum bound).` : s.detail };
  }
  if (r && s.status === "needs_approval" && (r.status === "validated" || r.status === "awaiting_approval")) {
    if (r.errorCount > 0 || !r.checksum) {
      return { ...base(s), tone: "blocked", detail: `The file has ${n(r.errorCount, "validation error")}. Fix and regenerate before approving.`, control: null, fix: { href: `/reports?state=${st}`, label: "Open in Reports" } };
    }
    const u = f.unverifiedRuleCount ?? 0;
    const relies = u > 0 ? ` It relies on ${n(u, "rule value")} that ${u === 1 ? "is" : "are"} still UNVERIFIED; to approve now you must tick "approve anyway".` : "";
    return {
      ...base(s),
      tone: "human",
      detail: `Your approval covers exactly this file: ${n(r.itemCount, "item")}, ${formatUSD(r.totalCents)}.${relies} The filing agent can only submit after you approve, and only to the replica portal.`,
      amountCents: r.totalCents,
      count: r.itemCount,
      unverified: u > 0,
      control: {
        kind: "human",
        op: "approve_report",
        label: u > 0 ? "Approve anyway" : "Approve submission",
        reportId: r.id,
        expectedChecksum: r.checksum,
        file: { itemCount: r.itemCount, totalCents: r.totalCents, checksum: r.checksum, fileHref: `/api/reports/${r.id}/file` },
        unverifiedCount: u,
      },
      fix: null,
    };
  }
  return waitingOnEarlier(fromPlan(s, st));
}

function reportSubmit(s: CloseStep, f: RunnerFacts): RunnerStep {
  const r = f.report;
  const run = f.run;
  const st = f.plan.state;
  if (r && LOCKED.has(r.status)) return fromPlan(s, st);
  if (run?.status === "running") {
    const paused = run.phase === "awaiting_approval";
    return {
      ...base(s),
      tone: paused ? "human" : "running",
      detail: paused ? "The filing agent filled the replica form and is paused before submitting. Approve the submission to let it continue." : "The filing agent is driving the replica portal now.",
      control: null,
      fix: null,
    };
  }
  if (r?.status === "approved") {
    const retry = run?.status === "failed";
    return {
      ...base(s),
      tone: "machine",
      detail: retry
        ? `The last filing run failed${run?.error ? `: ${run.error.slice(0, 160)}` : "."} Your approval still covers this file; you can run the agent again.`
        : `Approved. The filing agent signs in to the replica ${st} portal, uploads this exact file, checks the portal's totals against it and submits.`,
      control: { kind: "machine", op: "run_filing", label: retry ? "Run filing agent again" : "Run filing agent", reportId: r.id },
      fix: retry && run ? { href: `/runs/${run.id}`, label: "Open the failed run" } : null,
    };
  }
  if (r && (r.status === "validated" || r.status === "awaiting_approval") && s.status !== "blocked") {
    return { ...base(s), tone: "blocked", detail: "Waiting for your approval above. The agent never starts on an unapproved file from here.", control: null, fix: null };
  }
  if (s.status === "blocked" && run?.status === "failed") return fromPlan(s, st);
  return waitingOnEarlier(fromPlan(s, st));
}

function remit(s: CloseStep, f: RunnerFacts): RunnerStep {
  const st = f.plan.state;
  const step = fromPlan(s, st);
  const r = f.report;
  const owed = f.remitOwed;
  if (step.tone === "done" && f.remittance) {
    const x = f.remittance;
    return {
      ...step,
      detail: `Remitted ${formatUSD(x.totalCents)} for ${n(x.itemCount, "item")} on ${fmtIso(x.remittedOn)}${x.reference ? `, reference ${x.reference}` : ""}. Recorded by ${x.by}; the late clock stopped on that date.`,
      amountCents: x.totalCents,
      count: x.itemCount,
    };
  }
  if (step.tone === "human" && r && LOCKED.has(r.status) && owed && owed.count > 0) {
    return {
      ...step,
      detail: `Pay ${formatUSD(owed.totalCents)} to ${st} outside this app (nothing is paid from here), then record the payment. Recording moves ${n(owed.count, "reported item")} to Remitted, which stops the late clock and interest.`,
      amountCents: owed.totalCents,
      count: owed.count,
      control: { kind: "human", op: "record_remittance", label: "Record remittance", reportId: r.id, expectedCount: owed.count, expectedCents: owed.totalCents, defaultDate: f.plan.asOf },
      fix: null,
    };
  }
  if (step.tone === "human") return { ...step, fix: { href: fixHref(s, st), label: "Open reported items" } };
  return waitingOnEarlier(step);
}

/** R5-17: nothing to do this cycle is "Not needed" (grey), never "Done". */
function notNeeded(step: RunnerStep, f: RunnerFacts): RunnerStep {
  if (!LETTER_STEPS.has(step.id) || step.tone !== "done" || (f.ddItemCount ?? 1) > 0) return step;
  return { ...step, tone: "not_needed", detail: `Not needed this cycle: no ${f.plan.state} item is inside its due-diligence window, so no letter is due.`, amountCents: null, count: null };
}

/** R5-17: a step whose deadline passed and that is not done is marked late, with the days. */
function lateness(step: RunnerStep, f: RunnerFacts, daysLate: (date: string) => number): RunnerStep {
  if (step.tone === "done" || step.tone === "not_needed") return step;
  const due = REPORT_STEPS.has(step.id) ? f.late.reportDue : step.id === "remit" ? (f.late.remitDue ?? null) : null;
  if (!due || due >= f.plan.asOf) return step;
  return { ...step, late: { date: due, daysLate: daysLate(due) } };
}

function receiptOf(f: RunnerFacts): RunnerReceipt | null {
  const r = f.report;
  if (!r || !LOCKED.has(r.status)) return null;
  return {
    reportId: r.id,
    confirmation: r.confirmation,
    itemCount: r.itemCount,
    totalCents: r.totalCents,
    submittedAt: r.submittedAt,
    approvedBy: r.approvedBy,
    reportDue: f.late.reportDue,
    reportDueUnverified: f.late.reportDueUnverified,
    daysLate: f.late.daysLate,
    interest: f.late.interest,
    remitDue: f.plan.remitDue?.date ?? null,
    remitDueUnverified: f.plan.remitDue?.unverified ?? false,
    evidenceHref: `/api/reports/${r.id}/evidence`,
    fileHref: `/api/reports/${r.id}/file`,
    unverifiedRuleCount: f.unverifiedRuleCount ?? 0,
    remittance: f.remittance ?? null,
  };
}

/** Same facts in, same runner out. */
export function deriveRunner(f: RunnerFacts): RunnerView {
  const st = f.plan.state;
  const steps = f.plan.steps
    .map((s): RunnerStep => {
      switch (s.id) {
        case "letters_draft":
          return lettersDraft(s, st);
        case "letters_approve":
          return lettersApprove(s, f);
        case "letters_send":
          return lettersSend(s, f);
        case "report_generate":
          return reportGenerate(s, f);
        case "report_approve":
          return reportApprove(s, f);
        case "report_submit":
          return reportSubmit(s, f);
        case "remit":
          return remit(s, f);
        default:
          return fromPlan(s, st);
      }
    })
    .map((s) => lateness(notNeeded(s, f), f, (d) => daysBetween(d, f.plan.asOf)));
  const actionable = steps.find((s) => s.tone === "running" || (s.control !== null && (s.tone === "machine" || s.tone === "human")));
  const current = actionable ?? steps.find((s) => s.tone === "human") ?? null;
  const skipped = steps.filter((s) => s.tone === "not_needed").length;
  return {
    state: st,
    stateName: f.plan.stateName,
    asOf: f.plan.asOf,
    ruleVersion: f.plan.ruleVersion,
    atStakeCents: f.plan.atStakeCents,
    itemCount: f.plan.itemCount,
    steps,
    done: steps.filter((s) => s.tone === "done").length,
    total: steps.length - skipped,
    notNeeded: skipped,
    currentId: current?.id ?? null,
    filingRunId: f.run?.id ?? null,
    filingLive: f.run?.status === "running",
    receipt: receiptOf(f),
  };
}

/** Whole days from `from` to `to` (YYYY-MM-DD), UTC, no timezone drift. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}
