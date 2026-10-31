"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, CircleAlert, History } from "lucide-react";
import { DateCell, StatusPill } from "@/components/primitives";
import { getJson } from "@/components/b/api";
import type { AgentRunUi, ClockUi, ErrorUi, LinkUi, RunsUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { FooterLink, STATUS_LABEL, ViewCard } from "./parts";

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
  trace: { message?: string; kind?: string }[];
}

const POLL_MS = 1_800;

/** Live view of a browser-agent run. Polls the existing run endpoint until the run settles. */
export function AgentRunView({ runId, title }: AgentRunUi["props"]) {
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

  const steps = (run?.trace ?? []).filter((t) => t.message).slice(-6);
  return (
    <ViewCard
      testId="view-agent-run"
      icon={<Bot />}
      title={title}
      meta={run ? <RunStatus status={run.status} /> : null}
      footer={<FooterLink href={`/runs/${runId}`}>Full trace</FooterLink>}
    >
      <div className="space-y-2 px-4 py-3">
        {failed ? <p className="text-[13px] text-[var(--chat-pink-text)]">{failed}</p> : null}
        {!run && !failed ? <p className="text-[13px] text-[var(--chat-t3)]">Connecting to the run…</p> : null}
        {run?.phase === "awaiting_approval" ? (
          <p className="text-[13px] text-[var(--chat-t2)]">Paused for a person to approve in the app. The agent will not continue on its own.</p>
        ) : null}
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={`${i}-${s.message}`} className="flex gap-2 text-[13px] text-[var(--chat-t2)]">
              <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", i === steps.length - 1 && run?.status === "running" ? "chat-pulse bg-[var(--chat-blue-500)]" : "bg-[var(--chat-t4)]")} />
              <span className="text-pretty">{s.message}</span>
            </li>
          ))}
        </ol>
        {run?.error ? <p className="text-[13px] text-[var(--chat-pink-text)]">{run.error}</p> : null}
      </div>
    </ViewCard>
  );
}

export function ClockView({ today, offsetDays, canAdvance, change }: ClockUi["props"]) {
  return (
    <ViewCard
      testId="view-clock"
      icon={<CalendarDays />}
      title="Demo clock"
      meta={offsetDays ? `${offsetDays > 0 ? "+" : ""}${offsetDays} days from anchor` : "at anchor"}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-4">
        {change ? (
          <>
            <DateCell date={change.from} className="text-[15px] text-[var(--chat-t3)] line-through decoration-[var(--chat-t4)]" />
            <ArrowRight className="size-4 self-center text-[var(--chat-t3)]" aria-hidden />
          </>
        ) : null}
        <DateCell date={today} className="text-2xl font-semibold tracking-[-0.01em] text-[var(--chat-t1)]" />
        {!canAdvance ? <span className="text-xs text-[var(--chat-t3)]">Clock changes are disabled outside demo mode.</span> : null}
      </div>
      {change ? (
        <div className="border-t border-[var(--chat-line)] px-4 py-3">
          <p className="text-[13px] text-[var(--chat-t2)]">
            <span className="text-[var(--chat-t1)] tabular-nums">{change.transitionCount}</span> items changed status,{" "}
            <span className="text-[var(--chat-t1)] tabular-nums">{change.deadlinesMoved}</span> deadlines recomputed.
          </p>
          {change.transitions.length ? (
            <ul className="mt-2 space-y-1">
              {change.transitions.map((t, i) => (
                <li key={`${t.payeeName}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
                  <span className="truncate text-[var(--chat-t2)]">{t.payeeName}</span>
                  <span className="text-[var(--chat-t3)]">
                    {STATUS_LABEL[t.from] ?? t.from} <ArrowRight className="inline size-3" aria-hidden /> <span className="text-[var(--chat-blue-text)]">{STATUS_LABEL[t.to] ?? t.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
