"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { getJson } from "@/components/b/api";
import { cn } from "@/lib/utils";

/** How often a live filing run is re-read (agent steps take seconds). */
const POLL_MS = 1000;

interface TraceStep {
  kind?: string;
  message?: string;
  screenshot?: string;
}

interface RunData {
  status: string;
  phase: string | null;
  error: string | null;
  trace: TraceStep[];
}

const isShot = (t: TraceStep) => typeof t.screenshot === "string" && t.screenshot.toLowerCase().endsWith(".png");

/**
 * The filing agent's live progress: screenshots slide in as the run stores them (served by /runs/[id]/shots/[step]),
 * with the agent's own step messages beside them. Straight from the run row; nothing is synthesized. Polls while
 * the run is live and tells the runner once it settles.
 */
export function FilingFilmstrip({ runId, live, onSettled }: { runId: string; live: boolean; onSettled: () => void }) {
  const [run, setRun] = useState<RunData | null>(null);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const r = await getJson<RunData>(`/api/agents/runs/${runId}`);
      if (!alive) return;
      if (r.ok) setRun(r.data);
      if (r.ok && r.data.status !== "running") {
        if (live) settledRef.current();
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, live]);

  const trace = (run?.trace ?? []).map((t, step) => ({ ...t, step })).filter((t) => t.kind !== "guard_blocked" && Boolean(t.message));
  const shots = trace.filter(isShot);
  const running = run?.status === "running";
  const status = !run ? "Loading the run" : running ? (run.phase === "awaiting_approval" ? "Paused before submitting: waiting for your approval" : "Filing agent working on the replica portal") : `Run ${run.status}`;

  return (
    <section aria-labelledby="filmstrip-h" className="min-w-0 rounded-xl border border-line bg-ink-1 p-4" data-testid="filmstrip" data-run-status={run?.status ?? "loading"}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="filmstrip-h" className="flex items-center gap-2 text-sm font-medium text-fg-1">
          <span className={cn("size-1.5 shrink-0 rounded-full", running ? "es-pulse bg-blue-500" : "bg-fg-3")} aria-hidden />
          <span aria-live="polite">{status}</span>
        </h3>
        <Link href={`/runs/${runId}`} className="inline-flex items-center gap-1 rounded-sm text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline focus-visible:outline-2 focus-visible:outline-blue-400">
          Full run trace <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {shots.length > 0 ? (
        <ol className="flex snap-x gap-3 overflow-x-auto pb-2 [contain:inline-size]" tabIndex={0} aria-label="Filing agent screenshots, oldest first (scrolls sideways)">
          {shots.map((s) => (
            <li key={s.step} className="co-slide w-48 shrink-0 snap-start" data-testid="filmstrip-shot">
              <a href={`/runs/${runId}/shots/${s.step}`} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
                <img src={`/runs/${runId}/shots/${s.step}`} alt={`Step ${s.step + 1}: ${s.message}`} width={192} height={120} className="h-[120px] w-48 rounded-md border border-line bg-ink-2 object-cover object-top" />
              </a>
              <p className="mt-1 line-clamp-2 text-xs text-fg-2">
                <span className="num font-mono">#{s.step + 1}</span> {s.message}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {trace.length > 0 ? (
        <ol className="mt-2 space-y-1 border-t border-line pt-3 text-[13px]" aria-label="Filing agent steps">
          {trace.slice(-8).map((t) => (
            <li key={t.step} className="co-rise flex gap-2 text-fg-2" data-testid="filmstrip-step">
              <span className="num w-7 shrink-0 font-mono text-fg-2">#{t.step + 1}</span>
              <span className={cn("min-w-0 break-words", t.kind === "paused" || t.kind === "approval" ? "text-pink-300" : undefined)}>{t.message}</span>
            </li>
          ))}
        </ol>
      ) : run ? (
        <p className="text-[13px] text-fg-3">No steps recorded yet.</p>
      ) : null}
      {run?.error ? <p className="mt-2 text-[13px] break-words text-pink-400">{run.error}</p> : null}
    </section>
  );
}
