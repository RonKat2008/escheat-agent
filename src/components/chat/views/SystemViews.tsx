"use client";

import { useEffect, useState } from "react";
import { m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, CalendarDays, CircleAlert, History } from "lucide-react";
import { DateCell, StatusPill } from "@/components/primitives";
import { getJson, postJson } from "@/components/b/api";
import type { AgentRunUi, ClockUi, ErrorUi, LinkUi, RunsUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { AskButton, AttentionNote, FooterLink, ViewCard } from "./parts";

function RunStatus({ status }: { status: string }) {
  return <StatusPill status={status} className="text-xs" />;
}

export function RunsView({ runs }: RunsUi["props"]) {
  return (
    <ViewCard testId="view-runs" icon={<History />} title="Recent agent runs" footer={<FooterLink href="/runs">All runs</FooterLink>}>
      {runs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]">No runs yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--chat-line)]">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] focus-visible:bg-[var(--chat-ink-3)]">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-[var(--chat-t1)]">{r.agent}</span>
                  <span className="block truncate text-xs text-[var(--chat-t3)]">
                    {r.model ?? "no model"}
                    {r.inputTokens !== null ? `, ${(r.inputTokens + (r.outputTokens ?? 0)).toLocaleString("en-US")} tokens` : ""}
                    {r.costUsdMicros !== null ? `, $${(r.costUsdMicros / 1_000_000).toFixed(4)}` : ""}
                  </span>
                </span>
                <RunStatus status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ViewCard>
  );
}

interface RunSnapshot {
  status: string;
  phase: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  trace: { at?: string; message?: string; kind?: string }[];
}

const POLL_MS = 1_500;
const VISIBLE_STEPS = 6;

/** The replica fence blocking the app's own dev assets (HMR socket, fonts): noise, not progress. */
const DEV_ASSET_NOISE = /\[replica-fence\] (closed websocket|blocked) \S*\/(_next|__nextjs[^/\s]*)\//;

/** Trace lines worth showing a person: drops the fence blocking the dev server's own assets. */
export function visibleSteps(trace: RunSnapshot["trace"]): { message: string; kind: string }[] {
  return trace
    .filter((t): t is { message: string; kind?: string } => typeof t.message === "string" && t.message.trim() !== "")
    .filter((t) => !DEV_ASSET_NOISE.test(t.message))
    .map((t) => ({ message: t.message, kind: t.kind ?? "info" }));
}

/** m:ss from two timestamps (ms). */
export function elapsedLabel(fromMs: number, toMs: number): string {
  const sec = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Live view of a browser-agent run: polls the run endpoint, streams new steps in, and stops when the run settles. */
export function AgentRunView({ runId, title, agent }: AgentRunUi["props"]) {
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const r = await getJson<RunSnapshot>(`/api/agents/runs/${runId}`);
      if (!alive) return;
      if (!r.ok) {
        setFailed(r.error);
        return;
      }
      setRun(r.data);
      if (r.data.status === "running") timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const running = !run || run.status === "running";
  const now = useNow(Boolean(run) && running);
  const steps = visibleSteps(run?.trace ?? []);
  const shown = steps.slice(-VISIBLE_STEPS);
  const hidden = steps.length - shown.length;
  const started = run?.startedAt ? Date.parse(run.startedAt) : null;
  const ended = run?.finishedAt ? Date.parse(run.finishedAt) : now;
  const paused = run?.phase === "awaiting_approval";

  return (
    <ViewCard
      testId="view-agent-run"
      icon={<Bot />}
      title={title}
      meta={
        <span className="flex items-center gap-3">
          {started ? <span data-testid="agent-run-elapsed">{elapsedLabel(started, ended)}</span> : null}
          {run ? <RunStatus status={run.status} /> : null}
        </span>
      }
      footer={
        <>
          {agent === "recovery-agent" && run?.status === "succeeded" ? <AskButton question="What did the recovery search find?">Show what it found</AskButton> : null}
          <span className="flex-1" />
          <FooterLink href={`/runs/${runId}`}>Full trace</FooterLink>
        </>
      }
    >
      <div aria-hidden className="relative h-px overflow-hidden bg-[var(--chat-line)]">
        {running && !paused && !failed ? <span className="chat-indeterminate absolute inset-y-0 left-0 w-1/3 bg-[var(--chat-blue-500)]" /> : null}
      </div>
      <div className="space-y-2 px-4 py-3" aria-live="polite" aria-busy={running}>
        {failed ? <p className="text-[13px] text-[var(--chat-pink-text)]">{failed}</p> : null}
        {!run && !failed ? <p className="text-[13px] text-[var(--chat-t3)]">Connecting to the run…</p> : null}
        {paused ? <AttentionNote>Paused for a person to approve in the app. The agent will not continue on its own.</AttentionNote> : null}
        {hidden > 0 ? <p className="text-xs text-[var(--chat-t3)] tabular-nums">{hidden} earlier {hidden === 1 ? "step" : "steps"}</p> : null}
        <ol className="space-y-1.5" data-testid="agent-run-steps">
          {shown.map((s, i) => {
            const current = i === shown.length - 1 && running && !paused;
            return (
              <m.li
                key={`${hidden + i}-${s.message}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className={cn("flex gap-2 text-[13px]", current ? "text-[var(--chat-t1)]" : "text-[var(--chat-t2)]")}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[7px] size-1.5 shrink-0 rounded-full",
                    current ? "chat-pulse bg-[var(--chat-blue-500)]" : s.kind === "error" ? "bg-[var(--chat-pink)]" : "bg-[var(--chat-t4)]",
                  )}
                />
                <span className="min-w-0 text-pretty break-words">{s.message}</span>
              </m.li>
            );
          })}
        </ol>
        {run?.error ? <AttentionNote>{run.error}</AttentionNote> : null}
      </div>
    </ViewCard>
  );
}

interface ClockResult {
  today: string;
  offsetDays: number;
  transitions: { from: string; to: string }[];
  deadlinesMoved: number;
}

/**
 * Demo clock. advance_clock only proposes a date; the person moves it with the button here, which calls the same
 * guarded /api/clock route as the header control. The model never changes the date itself.
 */
export function ClockView({ today, offsetDays, canAdvance, proposal }: ClockUi["props"]) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<ClockResult | null>(null);

  async function move() {
    if (!proposal) return;
    setBusy(true);
    setProblem(null);
    // An absolute target, so a second click (or the same card after a reload) cannot move the clock twice.
    const r = await postJson<ClockResult>("/api/clock", { action: "advance_to", date: proposal.to });
    setBusy(false);
    if (!r.ok) {
      setProblem(r.error);
      return;
    }
    setResult(r.data);
    router.refresh();
  }

  const changed = result ? result.transitions.filter((t) => t.from !== t.to).length : 0;
  const shownToday = result?.today ?? today;
  const shownOffset = result?.offsetDays ?? offsetDays;

  return (
    <ViewCard
      testId="view-clock"
      icon={<CalendarDays />}
      title="Demo clock"
      meta={shownOffset ? `${shownOffset > 0 ? "+" : ""}${shownOffset} days from anchor` : "at anchor"}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-4">
        {proposal && !result ? (
          <>
            <DateCell date={today} className="text-[15px] text-[var(--chat-t3)]" />
            <ArrowRight className="size-4 self-center text-[var(--chat-t3)]" aria-hidden />
            <DateCell date={proposal.to} className="text-2xl font-semibold tracking-[-0.01em] text-[var(--chat-t1)]" />
            <span className="text-xs text-[var(--chat-t3)] tabular-nums">
              {proposal.days > 0 ? "+" : ""}
              {proposal.days} days
            </span>
          </>
        ) : (
          <DateCell date={shownToday} className="text-2xl font-semibold tracking-[-0.01em] text-[var(--chat-t1)]" />
        )}
        {!canAdvance ? <span className="text-xs text-[var(--chat-t3)]">Clock changes are disabled outside demo mode.</span> : null}
      </div>
      {proposal && !result && canAdvance ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--chat-line)] px-4 py-3">
          <p className="min-w-0 flex-1 basis-60 text-[13px] text-pretty text-[var(--chat-t2)]">
            Not moved yet. Moving the demo date recomputes every deadline in the app. Nothing is sent or filed.
          </p>
          <button
            type="button"
            data-testid="clock-move"
            disabled={busy}
            onClick={move}
            className="chat-focus inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--chat-blue)] px-3 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-[var(--chat-blue-700)] active:scale-[0.98] disabled:opacity-40"
          >
            <CalendarDays className="size-3.5" aria-hidden />
            {busy ? "Moving…" : "Move clock"}
          </button>
          {problem ? <AttentionNote className="basis-full">{problem}</AttentionNote> : null}
        </div>
      ) : null}
      {result ? (
        <p className="border-t border-[var(--chat-line)] px-4 py-3 text-[13px] text-[var(--chat-t2)]" role="status">
          Moved by you. <span className="text-[var(--chat-t1)] tabular-nums">{changed}</span> {changed === 1 ? "item" : "items"} changed status,{" "}
          <span className="text-[var(--chat-t1)] tabular-nums">{result.deadlinesMoved}</span> deadlines recomputed.
        </p>
      ) : null}
    </ViewCard>
  );
}

export function LinkCardView({ href, title, description }: LinkUi["props"]) {
  return (
    <Link
      href={href}
      data-testid="view-link"
      className="group flex items-center gap-3 rounded-[10px] border border-[var(--chat-line)] bg-[var(--chat-ink-2)] px-4 py-3 outline-none transition-[border-color,background-color] duration-150 hover:border-[var(--chat-blue-500)]/50 hover:bg-[var(--chat-blue-900)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-[var(--chat-t1)]">{title}</span>
        <span className="block truncate text-xs text-[var(--chat-t3)]">{description}</span>
      </span>
      <ArrowRight className="size-4 text-[var(--chat-t3)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--chat-blue-text)]" aria-hidden />
    </Link>
  );
}

export function ErrorView({ message }: ErrorUi["props"]) {
  return (
    <p data-testid="view-error" className="flex gap-2 rounded-[10px] border border-[var(--chat-pink)] bg-[var(--chat-pink-900)] px-3 py-2 text-[13px] text-[var(--chat-t1)]">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--chat-pink-text)]" aria-hidden />
      <span className="text-pretty">{message}</span>
    </p>
  );
}
