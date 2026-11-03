/**
 * The close-out RUNNER's step-state machine: the same 8 steps as the guided plan (derive.ts), each turned into the one
 * control the runner page may show for it. Pure: no I/O, no clock reads, no model. It never decides the law and it
 * never approves anything: an approval is always a `human` control that needs a typed approver name, and the server
 * re-checks it (session + approver + reviewed hash) on the existing approve routes.
 *
 * Tones: done | machine (one click runs a reversible step: drafts, compose, generate+validate, start the filing agent
 * AFTER a person approved) | human (pink: a person must act; approvals, sending letters, verifying rules, paying)
 * | running (the filing agent is working) | blocked (with the real reason and, where there is one, a link to fix it).
 */
import type { ClosePlan, CloseStep, CloseStepId } from "@/lib/chat/ui-types";
import type { StateInterest } from "@/lib/reports/late-money";

export interface RunnerLetter {
  outreachId: string;
  staleItemId: string;
  status: "draft" | "awaiting_approval" | "approved";
  composed: boolean;
  ready: boolean;
  problems: string[];
  /** outreachContentSha256 of the current draft: what the reviewer approves. */
  contentSha256: string;
}

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
}

export interface RunnerFacts {
  plan: ClosePlan;
  letters: RunnerLetter[];
  report: RunnerReport | null;
  run: RunnerRun | null;
  late: RunnerLate;
}

export type MachineControl =
  | { kind: "machine"; op: "draft_letters"; label: string }
  | { kind: "machine"; op: "compose_letters"; label: string; outreachIds: string[] }
  | { kind: "machine"; op: "generate_report"; label: string }
  | { kind: "machine"; op: "run_filing"; label: string; reportId: string };

export type HumanControl =
  | { kind: "human"; op: "approve_letters"; label: string; items: { outreachId: string; expectedContentSha256: string }[] }
  | { kind: "human"; op: "send_letters"; label: string; outreachIds: string[] }
  | { kind: "human"; op: "approve_report"; label: string; reportId: string; expectedChecksum: string };

export type RunnerControl = MachineControl | HumanControl;
export type RunnerOp = RunnerControl["op"];
export type RunnerTone = "done" | "machine" | "human" | "running" | "blocked";

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
  /** Where a person fixes or completes it elsewhere in the app (blocked reasons, rule verification, payment). */
  fix: { href: string; label: string } | null;
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
}

export interface RunnerView {
  state: string;
  stateName: string;
  asOf: string;
  ruleVersion: string | null;
  atStakeCents: number;
  itemCount: number;
  steps: RunnerStep[];
  done: number;
  total: number;
  /** The step the runner points at: the first one this page can act on (or the running one). */
  currentId: CloseStepId | null;
  /** The filing run to show live (running), or the last one (for its filmstrip). */
  filingRunId: string | null;
  filingLive: boolean;
  receipt: RunnerReceipt | null;
}

const LOCKED = new Set(["submitted", "confirmed"]);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

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

const base = (s: CloseStep) => ({ id: s.id, title: s.title, detail: s.detail, amountCents: s.amountCents, count: s.count, unverified: s.unverified });

function fromPlan(s: CloseStep, state: string): RunnerStep {
  if (s.status === "done") return { ...base(s), tone: "done", control: null, fix: null };
  if (s.status === "running") return { ...base(s), tone: "running", control: null, fix: null };
  if (s.status === "blocked") return { ...base(s), tone: "blocked", control: null, fix: { href: fixHref(s, state), label: s.linkLabel } };
  return { ...base(s), tone: "human", control: null, fix: { href: fixHref(s, state), label: s.linkLabel } };
}

function lettersDraft(s: CloseStep, state: string): RunnerStep {
  if (s.action?.kind === "draft_letters") return { ...base(s), tone: "machine", control: { kind: "machine", op: "draft_letters", label: s.action.label }, fix: null };
  return fromPlan(s, state);
}

function lettersApprove(s: CloseStep, f: RunnerFacts): RunnerStep {
  const st = f.plan.state;
  if (s.status === "done") return fromPlan(s, st);
  const drafts = f.letters.filter((l) => l.status !== "approved");
  if (drafts.length === 0) return fromPlan(s, st);
  const uncomposed = drafts.filter((l) => !l.composed);
  if (uncomposed.length > 0) {
    return {
      ...base(s),
      tone: "machine",
      detail: `${n(uncomposed.length, "letter draft")} ${uncomposed.length === 1 ? "is" : "are"} not composed yet. Composing writes the notice and checks the required language; nothing is approved or sent.`,
      control: { kind: "machine", op: "compose_letters", label: `Compose ${n(uncomposed.length, "letter")}`, outreachIds: uncomposed.map((l) => l.outreachId) },
      fix: null,
    };
  }
  const ready = drafts.filter((l) => l.ready);
  const problems = drafts.filter((l) => !l.ready);
  const fix = { href: fixHref(s, st), label: "Fix in Approvals" };
  if (ready.length === 0) {
    const first = problems[0]?.problems[0];
    return { ...base(s), tone: "blocked", detail: `${n(problems.length, "draft")} cannot be approved yet${first ? `: ${first}` : "."}`, control: null, fix };
  }
  return {
    ...base(s),
    tone: "human",
    detail: `${n(ready.length, "letter")} ${ready.length === 1 ? "is" : "are"} composed and ready for your approval.${problems.length ? ` ${n(problems.length, "other draft")} need fixing in Approvals first.` : ""} Nothing is sent when you approve.`,
    count: ready.length,
    control: {
      kind: "human",
      op: "approve_letters",
      label: `Approve ${n(ready.length, "letter")}`,
      items: ready.map((l) => ({ outreachId: l.outreachId, expectedContentSha256: l.contentSha256 })),
    },
    fix: problems.length ? fix : null,
  };
}

function lettersSend(s: CloseStep, f: RunnerFacts): RunnerStep {
  const approved = f.letters.filter((l) => l.status === "approved");
  if (s.status === "needs_approval" && approved.length > 0) {
    return {
      ...base(s),
      tone: "human",
      control: { kind: "human", op: "send_letters", label: `Send ${n(approved.length, "letter")} (Lob test mode)`, outreachIds: approved.map((l) => l.outreachId) },
      fix: null,
    };
  }
  return fromPlan(s, f.plan.state);
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
    return {
      ...base(s),
      tone: "human",
      detail: `Your approval covers exactly this file (${n(r.itemCount, "item")}). The filing agent can only submit after you approve, and only to the replica portal.`,
      control: { kind: "human", op: "approve_report", label: "Approve submission", reportId: r.id, expectedChecksum: r.checksum },
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
  const step = fromPlan(s, f.plan.state);
  if (step.tone === "human") return { ...step, fix: { href: fixHref(s, f.plan.state), label: "Open reported items" } };
  return waitingOnEarlier(step);
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
  };
}

/** Same facts in, same runner out. */
export function deriveRunner(f: RunnerFacts): RunnerView {
  const st = f.plan.state;
  const steps = f.plan.steps.map((s): RunnerStep => {
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
  });
  const actionable = steps.find((s) => s.tone === "running" || (s.control !== null && (s.tone === "machine" || s.tone === "human")));
  const current = actionable ?? steps.find((s) => s.tone === "human") ?? null;
  return {
    state: st,
    stateName: f.plan.stateName,
    asOf: f.plan.asOf,
    ruleVersion: f.plan.ruleVersion,
    atStakeCents: f.plan.atStakeCents,
    itemCount: f.plan.itemCount,
    steps,
    done: steps.filter((s) => s.tone === "done").length,
    total: steps.length,
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
