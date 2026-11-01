"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { refreshAfterRunAction } from "@/app/(app)/runs/actions";
import { getJson } from "./api";

/** How often an active run is re-read. Agent steps take seconds, so 1s keeps the UI within one beat of them. */
export const RUN_POLL_MS = 1000;

export interface RunSnapshot {
  status: string;
  phase: string | null;
  error: string | null;
  trace: { message?: string; kind?: string }[];
}

/** Polls /api/agents/runs/:id while the run is active, then refreshes server data once when it settles. */
export function useRun(initialRunId: string | null, label = "Agent run") {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const settled = useRef(false);
  const lastPhase = useRef<string | null>(null);
  const sawRunning = useRef(false);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    settled.current = false;
    lastPhase.current = null;
    sawRunning.current = false;
    const openRun = { label: "Open run", onClick: () => router.push(`/runs/${runId}`) };
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
        sawRunning.current = true;
        timer = setTimeout(poll, RUN_POLL_MS);
      } else if (!settled.current) {
        settled.current = true;
        // The run finished outside any request: drop the cached renders first, then re-read this page.
        await refreshAfterRunAction().catch(() => undefined);
        if (alive) startTransition(() => router.refresh());
        if (sawRunning.current) {
          const text = `${label} ${r.data.status === "succeeded" ? "finished" : r.data.status}`;
          if (r.data.status === "succeeded") toast.success(text, { action: openRun });
          else toast.error(text, { action: openRun });
        }
      }
    }
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, router, initialRunId, label]);

  return {
    runId,
    run,
    running: run?.status === "running",
    start: (id: string) => {
      setRun(null);
      setRunId(id);
      toast(`${label} started`, { description: "It keeps running if you leave this page.", action: { label: "Open run", onClick: () => router.push(`/runs/${id}`) } });
    },
  };
}
