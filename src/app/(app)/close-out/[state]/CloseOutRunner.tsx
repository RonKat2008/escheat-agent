"use client";

import { RuleVersion } from "@/components/ui/rule-version";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleAlert, Clock, Hourglass, LoaderCircle, Lock, MailX, Minus, Play } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { getJson } from "@/components/b/api";
import { Money, UnverifiedBadge } from "@/components/primitives";
import type { RunnerStep, RunnerTone, RunnerView } from "@/lib/close-out/runner-model";
import { isValidApproverName } from "@/lib/auth/approver";
import { fmtIso } from "@/lib/close-out/derive";
import { cn } from "@/lib/utils";
import { FilingFilmstrip } from "./FilingFilmstrip";
import { formatDate } from "@/lib/format";
import { RunnerReceipt } from "./RunnerReceipt";
import { LetterList, RemitFields, ReportFileSummary } from "./RunnerControls";
import { runOp, type OpInput } from "./runner-ops";
import "./runner.css";

const TONE: Record<RunnerTone, { word: string; text: string }> = {
  done: { word: "Done", text: "text-blue-300" },
  not_needed: { word: "Not needed", text: "text-fg-2" },
  machine: { word: "Ready to run", text: "text-blue-300" },
  running: { word: "Running", text: "text-blue-300" },
  human: { word: "Needs you", text: "text-pink-300" },
  blocked: { word: "Blocked", text: "text-pink-300" },
  missed: { word: "Not sent", text: "text-pink-300" },
};

function Marker({ tone, index }: { tone: RunnerTone; index: number }) {
  const base = "co-pop relative z-10 grid size-7 shrink-0 place-items-center rounded-full";
  if (tone === "done")
    return (
      <span key={tone} className={cn(base, "bg-blue-600 text-white")} aria-hidden>
        <Check className="size-4" strokeWidth={2.5} />
      </span>
    );
  if (tone === "not_needed")
    return (
      <span key={tone} className={cn(base, "border border-line-strong bg-ink-1 text-fg-3")} aria-hidden>
        <Minus className="size-3.5" strokeWidth={2} />
      </span>
    );
  if (tone === "running")
    return (
      <span key={tone} className={cn(base, "border-2 border-blue-500 bg-ink-1 text-blue-300")} aria-hidden>
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
      </span>
    );
  if (tone === "human")
    return (
      <span key={tone} className={cn(base, "border-2 border-pink-500 bg-ink-1 text-pink-300")} aria-hidden>
        <Hourglass className="size-3.5" strokeWidth={2} />
      </span>
    );
  if (tone === "missed")
    return (
      <span key={tone} className={cn(base, "border-2 border-pink-500 bg-ink-1 text-pink-300")} aria-hidden>
        <MailX className="size-3.5" strokeWidth={2} />
      </span>
    );
  if (tone === "blocked")
    return (
      <span key={tone} className={cn(base, "border border-pink-700 bg-ink-1 text-pink-400")} aria-hidden>
        <Lock className="size-3.5" strokeWidth={2} />
      </span>
    );
  return (
    <span key={tone} className={cn(base, "border-2 border-blue-500 bg-ink-1 font-mono text-xs text-blue-300")} aria-hidden>
      {index + 1}
    </span>
  );
}

/** One segment per step; the fill is a scaleX transform (compositor-only). */
function ProgressRail({ view }: { view: RunnerView }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-fg-1" data-testid="runner-progress" data-done={view.done} data-total={view.total}>
          <span className="num text-2xl font-semibold tracking-[-0.02em]">{view.done}</span>
          <span className="text-fg-2"> of {view.total} steps done</span>
          {view.notNeeded > 0 ? (
            <span className="text-fg-2" data-testid="runner-not-needed">
              {" "}
              · {view.notNeeded} not needed this cycle
            </span>
          ) : null}
        </p>
        <p className="text-[13px] text-fg-2" data-testid="runner-at-stake" data-cents={view.atStakeCents}>
          {view.remittedCents !== null ? (
            <>
              Cycle closed · <Money cents={view.remittedCents} /> remitted
            </>
          ) : (
            <>
              <Money cents={view.atStakeCents} /> at stake, {view.itemCount} {view.itemCount === 1 ? "item" : "items"}
            </>
          )}{" "}
          · as of {formatDate(view.asOf)}
          {view.ruleVersion ? <RuleVersion version={view.ruleVersion} className="ml-2 font-mono text-xs text-fg-3" /> : null}
        </p>
      </div>
      <div className="grid grid-cols-8 gap-1" role="progressbar" aria-label="Close-out progress" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done}>
        {view.steps.map((s) => {
          const current = s.id === view.currentId;
          const fill = s.tone === "done" ? "bg-blue-500" : current && s.tone === "human" ? "bg-pink-500" : current ? "bg-blue-500/60" : "bg-transparent";
          const on = s.tone === "done" || current;
          return (
            <span key={s.id} className={cn("relative h-1.5 overflow-hidden rounded-full", s.tone === "not_needed" ? "bg-ink-3/40" : "bg-ink-3")}>
              <span className={cn("co-fill absolute inset-0", fill, current && s.tone !== "done" && "es-pulse")} style={{ transform: `scaleX(${on ? 1 : 0})` }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface StepRowProps {
  step: RunnerStep;
  index: number;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  approver: string;
  onApprover: (v: string) => void;
  onRun: (step: RunnerStep, extra: Omit<OpInput, "approver">) => void;
  state: string;
  /** Live output under the step (the filing filmstrip). */
  children?: ReactNode;
}

/** The step's own inputs (letters read, "approve anyway", remittance fields) and whether they let the button run. */
function useStepInputs(step: RunnerStep) {
  const c = step.control;
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  // The remit control appears only after filing (the row mounted before it), so an untouched date derives from it.
  const [remitDraft, setRemit] = useState<{ date: string | null; reference: string }>({ date: null, reference: "" });
  const remit = { date: remitDraft.date ?? (c?.op === "record_remittance" ? c.defaultDate : ""), reference: remitDraft.reference };
  const toggle = (id: string) => {
    setShown((cur) => (cur === id ? null : id));
    setOpened((prev) => new Set(prev).add(id));
  };
  let ready = true;
  if (c?.op === "approve_letters") ready = c.letters.every((l) => opened.has(l.outreachId));
  if (c?.op === "approve_report") ready = (c.unverifiedCount === 0 && c.unsentNotices.length === 0) || ack;
  if (c?.op === "record_remittance") ready = /^\d{4}-\d{2}-\d{2}$/.test(remit.date) && remit.date <= c.defaultDate;
  return { opened, shown, toggle, ack, setAck, remit, setRemit, ready };
}

function LateChip({ late }: { late: NonNullable<RunnerStep["late"]> }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-pink-700 px-1.5 py-px text-[11px] font-medium text-pink-300" data-testid="runner-step-late">
      <Clock className="size-3" aria-hidden />
      Late · due {fmtIso(late.date)}, {late.daysLate} {late.daysLate === 1 ? "day" : "days"} ago
    </span>
  );
}

function StepRow({ step, index, current, busy, disabled, approver, onApprover, onRun, state, children }: StepRowProps) {
  const c = step.control;
  const human = c?.kind === "human";
  const needsName = human;
  const inputs = useStepInputs(step);
  return (
    <li
      className={cn(
        "relative flex gap-3.5 rounded-xl border p-4 sm:gap-4",
        current ? (step.tone === "human" ? "border-pink-600 bg-pink-900/30" : "border-blue-700 bg-blue-900/30") : "border-line bg-ink-2",
      )}
      data-testid="runner-step"
      data-step-id={step.id}
      data-tone={step.tone}
      data-late={step.late ? "true" : undefined}
      aria-current={current ? "step" : undefined}
    >
      <Marker tone={step.tone} index={index} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 className="text-sm font-medium text-fg-1">{step.title}</h3>
          <span className={cn("text-xs font-medium", TONE[step.tone].text)}>{TONE[step.tone].word}</span>
          {step.late ? <LateChip late={step.late} /> : null}
          {step.unverified ? <UnverifiedBadge compact /> : null}
          {step.amountCents !== null ? (
            <span className="num ml-auto text-[13px] text-fg-2">
              <Money cents={step.amountCents} />
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[13px] text-pretty text-fg-2" data-testid="runner-step-detail">
          {step.detail}
        </p>
        {c?.op === "approve_letters" || c?.op === "send_letters" ? (
          <LetterList letters={c.letters} opened={inputs.opened} shown={inputs.shown} onToggle={inputs.toggle} requireRead={c.op === "approve_letters"} />
        ) : null}
        {c?.op === "approve_report" ? (
          <ReportFileSummary file={c.file} unverifiedCount={c.unverifiedCount} unsentNotices={c.unsentNotices} acknowledged={inputs.ack} onAcknowledge={inputs.setAck} state={state} />
        ) : null}
        {c || step.fix ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {c?.op === "record_remittance" ? <RemitFields date={inputs.remit.date} reference={inputs.remit.reference} maxDate={c.defaultDate} onChange={inputs.setRemit} /> : null}
            {needsName ? (
              <div data-testid="runner-approver" className="w-full sm:w-60">
                <ApproverField value={approver} onChange={onApprover} />
              </div>
            ) : null}
            {c ? (
              <ActionButton
                variant="primary"
                pending={busy}
                disabled={disabled || (needsName && !isValidApproverName(approver)) || !inputs.ready}
                onClick={() => onRun(step, { acknowledged: inputs.ack, remit: inputs.remit })}
                data-testid="runner-action"
                data-op={c.op}
                className={cn("h-9", human && "bg-pink-600 hover:brightness-110 active:bg-pink-700")}
              >
                {human ? null : <Play className="size-3.5" strokeWidth={2} aria-hidden />}
                {c.label}
              </ActionButton>
            ) : null}
            {step.fix ? (
              <Link
                href={step.fix.href}
                data-testid="runner-fix"
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-md px-1 text-[13px] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-blue-400",
                  step.tone === "human" || step.tone === "blocked" ? "text-pink-300 hover:text-pink-200" : "text-blue-400 hover:text-blue-300",
                )}
              >
                {step.fix.label} <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </li>
  );
}

type Note = { tone: "ok" | "error"; text: string };

/**
 * The close-out runner: the 8 steps of one state's cycle, each with the one thing this page can do for it. Every
 * button calls an existing server path; approvals and sends are pink, need a typed name and are re-checked by the
 * server. After each action the page re-reads the runner from the records (GET /api/close-out/runner).
 */
export function CloseOutRunner({ initial }: { initial: RunnerView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [approver, setApprover] = useApprover();
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const router = useRouter();

  const reload = useCallback(async () => {
    const r = await getJson<{ runner: RunnerView }>(`/api/close-out/runner?state=${view.state}`);
    if (r.ok) setView(r.data.runner);
    else setNote({ tone: "error", text: `Could not re-read the runner: ${r.error}` });
    // R6-08: server-rendered figures around the runner (the shell's numbers) re-read the records too.
    router.refresh();
  }, [view.state, router]);

  async function run(step: RunnerStep, extra: Omit<OpInput, "approver">) {
    if (!step.control) return;
    setBusy(step.id);
    setNote(null);
    const r = await runOp(view.state, step.control, { ...extra, approver });
    if (r.ok && r.runId) setLiveRunId(r.runId);
    await reload();
    setBusy(null);
    setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
  }

  const runId = liveRunId ?? view.filingRunId;
  const live = view.filingLive || liveRunId !== null;
  const settled = useCallback(() => {
    setLiveRunId(null);
    // The run's own outcome (receipt or error) now speaks for it; drop the "started" note.
    setNote(null);
    void reload();
  }, [reload]);

  return (
    <div className="min-w-0 space-y-6" data-testid="close-out-runner" data-state={view.state}>
      <ProgressRail view={view} />
      {view.receipt ? <RunnerReceipt r={view.receipt} state={view.state} /> : null}
      <div aria-live="polite" className="empty:hidden" data-testid="runner-message">
        {note ? (
          <p className={cn("flex gap-2 rounded-lg border px-3.5 py-2.5 text-[13px]", note.tone === "ok" ? "border-blue-800 bg-blue-900/40 text-fg-1" : "border-pink-700 bg-pink-900/40 text-fg-1")}>
            {note.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.5} aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-blue-400" strokeWidth={1.75} aria-hidden />}
            <span className="text-pretty">{note.text}</span>
          </p>
        ) : null}
      </div>
      <ol className="space-y-2.5" aria-label={`Steps to close out ${view.stateName}`}>
        {view.steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            index={i}
            current={s.id === view.currentId}
            busy={busy === s.id}
            disabled={busy !== null || (s.control?.op === "run_filing" && view.filingLive)}
            approver={approver}
            onApprover={setApprover}
            onRun={run}
            state={view.state}
          >
            {s.id === "report_submit" && runId ? <FilingFilmstrip key={runId} runId={runId} live={live} onSettled={settled} /> : null}
          </StepRow>
        ))}
      </ol>
    </div>
  );
}
