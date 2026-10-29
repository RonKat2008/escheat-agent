"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { getJson } from "./api";

export interface RunSnapshot {
  status: string;
  phase: string | null;
  error: string | null;
  trace: { message?: string; kind?: string }[];
}

/** Polls /api/agents/runs/:id while the run is active, then refreshes server data once when it settles. */
export function useRun(initialRunId: string | null) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const settled = useRef(false);
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    settled.current = false;
    lastPhase.current = null;
    async function poll() {
      const r = await getJson<RunSnapshot>(`/api/agents/runs/${runId}`);
      if (!alive || !r.ok) return;
      setRun(r.data);
      // Server-rendered panels depend on phase changes too (e.g. the agent pausing at "Approve submission").
      if (r.data.phase && r.data.phase !== lastPhase.current) {
        // A run attached on page load already rendered with its current phase; a run started here has not.
        const alreadyRendered = lastPhase.current === null && runId === initialRunId;
        lastPhase.current = r.data.phase;
        if (!alreadyRendered && r.data.status === "running") startTransition(() => router.refresh());
      }
      if (r.data.status === "running") {
        timer = setTimeout(poll, 1800);
      } else if (!settled.current) {
        settled.current = true;
        startTransition(() => router.refresh());
      }
    }
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router, initialRunId]);

  return {
    runId,
    run,
    running: run?.status === "running",
    start: (id: string) => {
      setRun(null);
      setRunId(id);
    },
  };
}
