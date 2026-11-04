"use client";

import { BookCheck, Download, GitCompareArrows, Hand, PenLine, Send, Tags, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, STAGES, type Stage } from "@/lib/theater/steps";

const ICON: Record<Stage, LucideIcon> = {
  ingest: Download,
  reconcile: GitCompareArrows,
  classify: Tags,
  rules: BookCheck,
  draft: PenLine,
  approval: Hand,
  execute: Send,
};

const SUB: Partial<Record<Stage, string>> = {
  rules: "deterministic, sourced",
  approval: "a person decides",
  execute: "replica / Lob test",
};

interface Count {
  total: number;
  model: number;
  rules: number;
}

interface PipelineProps {
  counts: Record<Stage, Count>;
  /** The stage the current step sits in (null before the first step). */
  active: Stage | null;
  visited: ReadonlySet<Stage>;
  /** The token is parked at the approval gate. */
  waiting: boolean;
  isStatic: boolean;
  onFocusStage: (s: Stage) => void;
}

const N = STAGES.length;
/** Column centre of stage i as a share of the track. */
const centre = (i: number): number => ((i + 0.5) / N) * 100;

/**
 * The fixed pipeline: Ingest → … → Human approval gate → Execute. Motion is transform/opacity only: the token is a
 * full-width layer translated by a percentage, the progress rail is a scaleX. In static mode neither is drawn.
 */
export function Pipeline({ counts, active, visited, waiting, isStatic, onFocusStage }: PipelineProps) {
  const activeIdx = active ? STAGES.indexOf(active) : -1;
  const progress = activeIdx < 0 ? 0 : activeIdx / (N - 1);
  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 focus-visible:outline-2 focus-visible:outline-blue-400"
      tabIndex={0}
      role="region"
      aria-label="Agent pipeline, scrolls sideways on small screens"
    >
      <div className="relative min-w-[720px] overflow-hidden rounded-[12px] border border-line bg-ink-1 px-2 pt-6 pb-4 shadow-[inset_0_1px_0_var(--color-ink-3)]" data-testid="theater-pipeline">
        {/* rail between the first and last node centres */}
        <div aria-hidden className="pointer-events-none absolute top-[48px] h-px bg-line-strong" style={{ left: `${centre(0)}%`, right: `${100 - centre(N - 1)}%` }} />
        {!isStatic ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-[47px] h-[3px] origin-left rounded-full bg-blue-500/70 transition-transform duration-500 ease-out"
            style={{ left: `${centre(0)}%`, width: `${centre(N - 1) - centre(0)}%`, transform: `scaleX(${progress})` }}
          />
        ) : null}
        {!isStatic && activeIdx >= 0 ? (
          <div
            aria-hidden
            data-testid="theater-token"
            className="pointer-events-none absolute inset-x-0 top-[48px] z-20 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translateX(${centre(activeIdx)}%)` }}
          >
            <span
              className={cn(
                "absolute -top-[9px] -left-[9px] block size-[18px] rounded-full border-2 border-ink-0 shadow-[0_0_0_4px_var(--color-ink-1)] transition-opacity duration-300",
                waiting ? "bg-pink-500" : "bg-blue-400",
              )}
            />
            <span className={cn("absolute -top-[17px] -left-[17px] block size-[34px] animate-ping rounded-full opacity-40", waiting ? "bg-pink-500" : "bg-blue-500")} />
          </div>
        ) : null}
        <ol className="relative z-10 grid" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
          {STAGES.map((s) => {
            const Icon = ICON[s];
            const c = counts[s];
            const gate = s === "approval";
            const isActive = active === s;
            const seen = visited.has(s);
            return (
              <li key={s} className="flex min-w-0 flex-col items-center px-1 text-center" data-testid={`stage-${s}`} data-stage={s} data-active={isActive ? "true" : undefined}>
                <button
                  type="button"
                  onClick={() => onFocusStage(s)}
                  disabled={c.total === 0}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`${STAGE_LABEL[s]}: ${c.total} ${c.total === 1 ? "step" : "steps"}${gate && waiting ? ", waiting on a person" : ""}`}
                  className={cn(
                    "relative grid size-12 place-items-center rounded-full border-2 bg-ink-2 transition-[background-color,border-color,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 enabled:hover:scale-105 disabled:cursor-default",
                    gate
                      ? cn("border-pink-500", isActive || (isStatic && waiting) ? "bg-pink-900" : "")
                      : isActive
                        ? "border-blue-400 bg-blue-900"
                        : seen || (isStatic && c.total > 0)
                          ? "border-blue-700"
                          : "border-line-strong",
                  )}
                >
                  <Icon className={cn("size-5", gate ? "text-pink-400" : isActive || seen || (isStatic && c.total > 0) ? "text-blue-300" : "text-fg-3")} strokeWidth={1.5} aria-hidden />
                </button>
                <span className={cn("mt-2 text-[12.5px] leading-4 font-medium", gate ? "text-pink-300" : "text-fg-1")}>{STAGE_LABEL[s]}</span>
                {SUB[s] ? <span className="mt-0.5 text-[11px] leading-4 text-fg-3">{SUB[s]}</span> : null}
                <span className="num mt-1 text-[11px] text-fg-2">
                  {c.total} {c.total === 1 ? "step" : "steps"}
                </span>
                <span className="mt-1 flex flex-wrap justify-center gap-1">
                  {c.model > 0 ? <span className="rounded-[4px] bg-blue-600 px-1.5 text-[10.5px] leading-4 font-medium text-fg-1">model {c.model}</span> : null}
                  {c.rules > 0 ? (
                    <span className="rounded-[4px] border border-blue-300 px-1.5 text-[10.5px] leading-4 text-blue-200" data-testid="rules-engine-chip">
                      rules engine {c.rules}
                    </span>
                  ) : null}
                </span>
                {gate && waiting ? (
                  <span className="mt-1.5 rounded-[4px] border border-pink-500 bg-pink-950 px-1.5 text-[11px] leading-5 font-medium text-pink-300" data-testid="gate-waiting">
                    waiting on a person
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
