"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { getJson } from "@/components/b/api";
import { formatDuration } from "@/components/b/trace";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { cn } from "@/lib/utils";
import type { TheaterRun } from "@/lib/queries/theater";
import { followCursor, holdMs, isWaitingAtGate, LIVE_POLL_MS, SPEEDS, type Speed } from "@/lib/theater/playback";
import { stageCounts, type Stage } from "@/lib/theater/steps";
import { absoluteTime } from "../runs/run-meta";
import { Pipeline } from "./Pipeline";
import { StepDetail, StepLog } from "./StepPanels";

export interface OtherRun {
  id: string;
  label: string;
  status: string;
  startedAt: string;
}

interface Props {
  initial: TheaterRun;
  agentName: string;
  others: OtherRun[];
}

/** "auto" = autoplay once motion is known to be allowed; the viewer's own choice replaces it. */
type PlayState = "auto" | "playing" | "paused";

function ModeBadge({ live, run }: { live: boolean; run: TheaterRun }) {
  if (live) {
    return (
      <span className="inline-flex h-7 items-center gap-2 rounded-md border border-blue-500 bg-blue-950 px-2.5 text-[13px] font-medium text-blue-200" data-testid="theater-mode">
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-blue-400" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex min-h-7 flex-wrap items-center gap-x-1 rounded-md border border-line-strong px-2.5 py-1 text-[13px] text-fg-2" data-testid="theater-mode">
      <span>
        Replay of run <span className="font-mono text-[12px] break-all text-fg-1">{run.id}</span>,
      </span>
      <time dateTime={run.startedAt}>{absoluteTime(new Date(run.startedAt))}</time>
    </span>
  );
}

function RunFacts({ run }: { run: TheaterRun }) {
  // Clamped: rows written in one statement can carry a finish a hair before their start.
  const dur = run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null;
  const hasTokens = run.inputTokens != null || run.outputTokens != null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:flex sm:flex-wrap">
      <div>
        <dt className="text-xs text-fg-3">Steps</dt>
        <dd className="num text-fg-1" data-testid="theater-step-count">{run.steps.length}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-3">Status</dt>
        <dd className="text-fg-1">{run.status}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-3">Duration</dt>
        <dd className="num text-fg-1">{dur != null ? formatDuration(dur) : run.status === "running" ? "Running" : "Not recorded"}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-fg-3">Model</dt>
        <dd className="truncate font-mono text-[12.5px] text-fg-1" title={run.model ?? undefined}>
          {run.noModel ? <span className="font-sans text-fg-2">{run.replay ? `Recorded answer replayed offline (${run.model ?? "model"}), not billed` : `No model call (${run.model ?? "scripted"})`}</span> : (run.model ?? <span className="font-sans text-fg-3">Not recorded</span>)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-fg-3">Tokens in / out (whole run)</dt>
        <dd className="num text-fg-1">
          {hasTokens ? `${(run.inputTokens ?? 0).toLocaleString("en-US")} / ${(run.outputTokens ?? 0).toLocaleString("en-US")}` : <span className="text-fg-3">Not recorded</span>}
        </dd>
      </div>
    </dl>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full bg-blue-600" /> Model step
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-[2px] border border-blue-300" /> Rules engine (deterministic, sourced)
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border-2 border-pink-500" /> A person must act
      </li>
    </ul>
  );
}

export function TheaterView({ initial, agentName, others }: Props) {
  const tier = useRenderTier();
  const isStatic = tier === "static";
  const [run, setRun] = useState<TheaterRun>(initial);
  const [cursor, setCursor] = useState(initial.status === "running" ? Math.max(0, initial.steps.length - 1) : 0);
  const [playState, setPlayState] = useState<PlayState>("auto");
  const [speed, setSpeed] = useState<Speed>(1);
  const steps = run.steps;
  const live = run.status === "running";
  const last = steps.length - 1;
  const atEnd = cursor >= last;
  const playing = !isStatic && !live && steps.length > 1 && !atEnd && (playState === "playing" || playState === "auto");

  // Replay: advance one step per hold. The approval gate holds longer; the timer is the only motion driver.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setCursor((c) => Math.min(c + 1, last)), holdMs(steps[cursor], speed));
    return () => clearTimeout(t);
  }, [playing, cursor, speed, steps, last]);

  // Live: re-read the stored run every ~2s and append whatever new rows were written.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await getJson<TheaterRun>(`/api/theater/runs/${run.id}`);
      if (!alive || !r.ok) return;
      setCursor((c) => followCursor(c, run.steps.length, r.data.steps.length));
      setRun(r.data);
    }, LIVE_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [live, run]);

  // Static mode shows the whole run at once: the diagram counts every step; motion mode counts what has "happened".
  const shown = isStatic || live ? steps : steps.slice(0, cursor + 1);
  const counts = stageCounts(shown);
  const visited = new Set<Stage>(shown.map((s) => s.stage));
  const current = steps[Math.min(cursor, Math.max(0, last))] ?? null;
  const active: Stage | null = current?.stage ?? null;
  const waiting = isStatic ? isWaitingAtGate(steps, last) : current?.stage === "approval";

  const focusStage = (s: Stage) => {
    const i = steps.findIndex((x) => x.stage === s);
    if (i < 0) return;
    setPlayState("paused");
    setCursor(i);
  };
  const select = (i: number) => {
    setPlayState("paused");
    setCursor(i);
  };
  const togglePlay = () => {
    if (playing) return setPlayState("paused");
    if (atEnd) setCursor(0);
    setPlayState("playing");
  };

  return (
    <div className="space-y-6" data-testid="theater" data-run-id={run.id} data-step-count={steps.length} data-trace-length={run.traceLength} data-mode={live ? "live" : "replay"} data-motion={isStatic ? "static" : "motion"} data-cursor={cursor} data-playing={playing ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ModeBadge live={live} run={run} />
        <p className="text-sm text-fg-1">
          <span className="font-medium">{agentName}</span>
          <Link href={`/runs/${run.id}`} className="ml-3 text-[13px] text-fg-2 underline underline-offset-2 hover:text-fg-1">
            Open the full run record
          </Link>
        </p>
      </div>
      <RunFacts run={run} />

      <div className="space-y-3">
        <Pipeline counts={counts} active={isStatic ? null : active} visited={visited} waiting={waiting} isStatic={isStatic} onFocusStage={focusStage} />
        <Legend />
      </div>

      {!isStatic && !live && steps.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[10px] border border-line bg-ink-1 px-3 py-2.5" role="group" aria-label="Playback">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[13px] font-medium text-fg-1 transition-[background-color,transform] duration-150 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98]"
            data-testid="theater-play"
          >
            {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {playing ? "Pause" : atEnd ? "Replay" : "Play"}
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "num h-8 min-w-10 rounded-md border px-2 text-[13px] transition-[background-color,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-blue-400",
                  speed === s ? "border-blue-500 bg-blue-950 text-fg-1" : "border-line text-fg-2 hover:border-line-hover hover:text-fg-1",
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <label className="flex min-w-[200px] flex-1 items-center gap-3 text-xs text-fg-3">
            <span className="shrink-0">Scrub</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, last)}
              step={1}
              value={Math.min(cursor, Math.max(0, last))}
              onChange={(e) => select(Number(e.target.value))}
              aria-valuetext={current ? `Step ${cursor + 1} of ${steps.length}: ${current.label}` : undefined}
              className="w-full accent-blue-500"
              data-testid="theater-scrubber"
            />
            <span className="num shrink-0 text-fg-2">
              {Math.min(cursor + 1, steps.length)} / {steps.length}
            </span>
          </label>
        </div>
      ) : isStatic ? (
        <p className="text-xs text-fg-3" data-testid="theater-static-note">
          Reduced motion: the whole run is shown at once. Pick any step in the log to read it.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <StepDetail step={current} position={Math.min(cursor, Math.max(0, last))} total={steps.length} live={live} />
        <section aria-labelledby="theater-log-heading" className="min-w-0">
          <h2 id="theater-log-heading" className="mb-2 text-sm font-medium text-fg-1">
            Step log
          </h2>
          <div className="max-h-[520px] overflow-y-auto rounded-[10px] border border-line bg-ink-1 p-1.5" tabIndex={0} role="region" aria-label="Step log, scrollable">
            <StepLog steps={steps} cursor={cursor} dimFuture={!isStatic && !live} onSelect={select} />
          </div>
        </section>
      </div>

      {others.length ? (
        <nav aria-label="Other recorded runs" className="border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-medium text-fg-1">Other recorded runs</h2>
          <ul className="flex flex-wrap gap-2">
            {others.slice(0, 8).map((o) => (
              <li key={o.id}>
                <Link
                  href={`/theater?run=${o.id}`}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-[13px] text-fg-2 transition-colors duration-150 hover:border-line-hover hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  {o.label}
                  <time dateTime={o.startedAt} className="num text-xs text-fg-3">
                    {absoluteTime(new Date(o.startedAt)).replace(/, \d{4}/, "")}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
