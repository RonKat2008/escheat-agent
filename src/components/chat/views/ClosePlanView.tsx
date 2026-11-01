"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowUpRight, Check, CircleAlert, Hourglass, ListChecks, LoaderCircle, Lock, RotateCw } from "lucide-react";
import { refreshClosePlan, runClosePlanStep } from "@/app/(app)/chat/actions";
import { Money } from "@/components/primitives";
import type { ClosePlan, ClosePlanUi, CloseStep, CloseStepId, CloseStepStatus } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { changedSteps } from "./close-plan";
import { fmtDate, UnknownFlag, UnverifiedFlag, ViewCard } from "./parts";

const EASE = [0.16, 1, 0.3, 1] as const;

const STATUS: Record<CloseStepStatus, { label: string; text: string }> = {
  done: { label: "Done", text: "text-[var(--chat-blue-text)]" },
  ready: { label: "Ready, chat can do this", text: "text-[var(--chat-blue-300)]" },
  running: { label: "Running", text: "text-[var(--chat-blue-text)]" },
  needs_approval: { label: "Needs you", text: "text-[var(--chat-pink-text)]" },
  blocked: { label: "Blocked", text: "text-[var(--chat-pink-text)]" },
};

function StepNode({ status, primary }: { status: CloseStepStatus; primary: boolean }) {
  const reduce = useReducedMotion();
  const icon: Record<CloseStepStatus, ReactNode> = {
    done: <Check className="size-3.5 text-white" strokeWidth={2.5} />,
    ready: <span className="size-2 rounded-full bg-[var(--chat-blue-500)]" />,
    running: <LoaderCircle className="chat-spinner size-3.5 text-[var(--chat-blue-text)]" strokeWidth={2} />,
    needs_approval: <Hourglass className="size-3 text-[var(--chat-pink-text)]" strokeWidth={2} />,
    blocked: <Lock className="size-3 text-[var(--chat-pink-text)]" strokeWidth={2} />,
  };
  return (
    <span className="relative z-10 grid size-6 place-items-center" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={status}
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
          className={cn(
            "grid size-6 place-items-center rounded-full border bg-[var(--chat-ink-1)]",
            status === "done" && "border-[var(--chat-blue)] bg-[var(--chat-blue)]",
            (status === "ready" || status === "running") && "border-[var(--chat-blue-500)]",
            status === "needs_approval" && "border-[var(--chat-pink)]",
            status === "blocked" && "border-dashed border-[var(--chat-pink)]",
            primary && "close-node-primary",
          )}
        >
          {icon[status]}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

const ctaBase =
  "chat-focus inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
const ctaPrimary = "bg-[var(--chat-blue)] text-white shadow-[0_0_0_1px_rgb(31_91_255/0.4),0_6px_20px_-6px_rgb(31_91_255/0.7)] hover:bg-[var(--chat-blue-700)]";
const ctaText = "px-2 font-normal text-[var(--chat-t2)] hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]";
const ctaQuiet = "border border-[var(--chat-line-strong)] text-[var(--chat-t1)] hover:border-[var(--chat-blue-text)]/50 hover:bg-[var(--chat-ink-3)]";

function StepRow({
  step,
  index,
  last,
  primary,
  changed,
  busy,
  onRun,
}: {
  step: CloseStep;
  index: number;
  last: boolean;
  primary: boolean;
  changed: boolean;
  busy: CloseStepId | null;
  onRun: (id: CloseStepId) => void;
}) {
  const s = STATUS[step.status];
  const running = busy === step.id;
  return (
    <li
      data-testid="close-step"
      data-step-id={step.id}
      data-status={step.status}
      className={cn("relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3.5", primary && "close-step-primary", changed && "close-step-changed")}
    >
      {last ? null : (
        <span aria-hidden className="absolute top-[2.4rem] bottom-[-0.9rem] left-[1.72rem] w-px bg-[var(--chat-line-strong)]">
          <span
            className="close-rail-fill absolute inset-0 origin-top bg-[var(--chat-blue-500)]"
            style={{ transform: `scaleY(${step.status === "done" ? 1 : 0})` }}
          />
        </span>
      )}
      <StepNode status={step.status} primary={primary} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h4 className="min-w-0 text-[14px] leading-6 font-medium text-[var(--chat-t1)]">
            <span className="mr-1.5 text-[var(--chat-t4)] tabular-nums">{index + 1}</span>
            {step.title}
          </h4>
          {step.amountCents !== null ? (
            <span className="flex items-center gap-2 text-[13px] text-[var(--chat-t1)] tabular-nums">
              {step.unverified ? <UnverifiedFlag compact /> : null}
              <Money cents={step.amountCents} />
              {step.count ? <span className="text-xs text-[var(--chat-t3)]">{step.count} {step.count === 1 ? "item" : "items"}</span> : null}
            </span>
          ) : null}
        </div>
        <p className={cn("mt-0.5 flex items-center gap-1.5 text-xs font-medium", s.text)} data-testid="close-step-status">
          {step.status === "blocked" ? <CircleAlert className="size-3.5" strokeWidth={1.75} aria-hidden /> : null}
          {s.label}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-pretty text-[var(--chat-t2)]">{step.detail}</p>
        {step.status !== "done" ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {step.action ? (
              <button
                type="button"
                data-testid="close-step-action"
                disabled={busy !== null}
                onClick={() => onRun(step.id)}
                className={cn(ctaBase, primary ? ctaPrimary : ctaQuiet)}
              >
                {running ? <LoaderCircle className="chat-spinner size-3.5" strokeWidth={2} aria-hidden /> : null}
                {running ? "Working…" : step.action.label}
              </button>
            ) : null}
            <Link
              href={step.href}
              data-testid="close-step-link"
              className={cn(ctaBase, primary && !step.action ? ctaPrimary : step.action || step.status === "blocked" ? ctaText : ctaQuiet, !step.action && step.status === "blocked" && "-ml-2")}
            >
              {step.linkLabel}
              <ArrowUpRight className="size-3.5 opacity-70" aria-hidden />
            </Link>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function DueLine({ label, due }: { label: string; due: ClosePlan["reportDue"] }) {
  if (!due) return <span className="text-[13px] text-[var(--chat-t3)]">Nothing due</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {due.date ? <span className="text-[15px] font-semibold text-[var(--chat-t1)] tabular-nums">{fmtDate(due.date)}</span> : <UnknownFlag />}
      {due.unverified ? <UnverifiedFlag compact /> : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ProgressRail({ plan }: { plan: ClosePlan }) {
  return (
    <div
      role="progressbar"
      aria-label={`${plan.state} close-out progress`}
      aria-valuemin={0}
      aria-valuemax={plan.total}
      aria-valuenow={plan.done}
      aria-valuetext={`${plan.done} of ${plan.total} steps done`}
      className="flex gap-1 px-4 pb-4"
      data-testid="close-rail"
    >
      {plan.steps.map((s) => (
        <span key={s.id} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--chat-ink-3)]" data-status={s.status}>
          <span
            className={cn(
              "close-rail-fill absolute inset-0 origin-left rounded-full",
              s.status === "done" && "bg-[var(--chat-blue)]",
              s.id === plan.nextStepId && "bg-[var(--chat-blue-500)]/45",
              (s.status === "blocked" || (s.status === "needs_approval" && s.id !== plan.nextStepId)) && "bg-[var(--chat-pink)]/55",
              s.status === "running" && "chat-pulse bg-[var(--chat-blue-500)]/60",
            )}
            style={{ transform: `scaleX(${s.status === "ready" && s.id !== plan.nextStepId ? 0 : 1})` }}
          />
        </span>
      ))}
    </div>
  );
}

export function ClosePlanView({ plan: initial }: ClosePlanUi["props"]) {
  const [plan, setPlan] = useState<ClosePlan>(initial);
  const [changed, setChanged] = useState<Set<CloseStepId>>(new Set());
  const [busy, setBusy] = useState<CloseStepId | "refresh" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (changed.size === 0) return;
    const t = setTimeout(() => setChanged(new Set()), 1800);
    return () => clearTimeout(t);
  }, [changed]);

  const apply = (next: ClosePlan) => {
    setChanged(changedSteps(plan, next));
    setPlan(next);
  };

  const run = async (id: CloseStepId) => {
    setBusy(id);
    setNote(null);
    try {
      const r = await runClosePlanStep(plan.state, id);
      if (r.plan) apply(r.plan);
      setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
    } catch {
      setNote({ tone: "error", text: "Could not reach the server. Nothing changed; try again." });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    setNote(null);
    try {
      const r = await refreshClosePlan(plan.state);
      if (r.ok) {
        apply(r.plan);
        setNote({ tone: "ok", text: `Refreshed: ${r.plan.done} of ${r.plan.total} done.` });
      } else setNote({ tone: "error", text: r.error });
    } catch {
      setNote({ tone: "error", text: "Could not reach the server. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const stepBusy = busy === "refresh" ? null : busy;
  const remaining = plan.total - plan.done;
  const next = plan.steps.find((s) => s.id === plan.nextStepId);

  return (
    <ViewCard
      testId="view-close-plan"
      icon={<ListChecks />}
      title={`Close out ${plan.stateName}`}
      meta={`as of ${fmtDate(plan.asOf)}`}
      className="close-plan"
      footer={
        <>
          <span className="min-w-0 flex-1 basis-56 text-xs text-pretty text-[var(--chat-t3)]">
            Approving, sending, submitting and paying happen only at their gates in the app. Chat cannot do them.
          </span>
          <button
            type="button"
            data-testid="close-refresh"
            onClick={refresh}
            disabled={busy !== null}
            className="chat-focus inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-[var(--chat-t2)] transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)] disabled:opacity-50"
          >
            <RotateCw className={cn("size-3.5", busy === "refresh" && "chat-spinner")} strokeWidth={1.75} aria-hidden />
            Refresh
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 pt-4 pb-4 @lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="col-span-2 @lg:col-span-1">
          <p className="text-xs text-[var(--chat-t3)]">Cycle progress</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-[var(--chat-t1)]" data-testid="close-progress" data-done={plan.done} data-total={plan.total}>
            <span className="sr-only">{`${plan.done} of ${plan.total} done`}</span>
            <span className="text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums" aria-hidden>
              <NumberFlow value={plan.done} />
            </span>
            <span className="text-[15px] text-[var(--chat-t3)] tabular-nums" aria-hidden>
              of {plan.total} done
            </span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--chat-t3)]">
            {remaining === 0 ? "Cycle closed." : next ? <>Next: <span className="text-[var(--chat-t1)]">{next.title}</span></> : `${remaining} left, waiting on blockers.`}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--chat-t3)]">At stake</p>
          <p className="mt-1 text-[15px] font-semibold text-[var(--chat-t1)] tabular-nums">
            <Money cents={plan.atStakeCents} />
          </p>
          <p className="mt-0.5 text-xs text-[var(--chat-t3)] tabular-nums">
            {plan.itemCount} {plan.itemCount === 1 ? "item" : "items"} this cycle
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--chat-t3)]">Report due</p>
          <div className="mt-1">
            <DueLine label="Report due" due={plan.reportDue} />
          </div>
          {plan.ruleVersion ? <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--chat-t3)]">rules {plan.ruleVersion}</p> : null}
        </div>
      </div>
      <ProgressRail plan={plan} />
      <ol className="border-t border-[var(--chat-line)]" aria-label={`Steps to close out ${plan.stateName}`}>
        {plan.steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            index={i}
            last={i === plan.steps.length - 1}
            primary={s.id === plan.nextStepId}
            changed={changed.has(s.id)}
            busy={stepBusy}
            onRun={run}
          />
        ))}
      </ol>
      <div aria-live="polite" className="empty:hidden" data-testid="close-message">
        {note ? (
          <p className={cn("flex gap-2 border-t border-[var(--chat-line)] px-4 py-2.5 text-[13px]", note.tone === "ok" ? "text-[var(--chat-t2)]" : "text-[var(--chat-t1)]")}>
            {note.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--chat-pink-text)]" strokeWidth={1.5} aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-[var(--chat-blue-text)]" strokeWidth={1.75} aria-hidden />}
            <span className="text-pretty">{note.text}</span>
          </p>
        ) : null}
      </div>
    </ViewCard>
  );
}
