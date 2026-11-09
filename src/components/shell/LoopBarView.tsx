"use client";

import Link from "next/link";
import { isHeroPage } from "./loop-slot";
import { useShellLocation } from "./useShellLocation";
import { m, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { MotionMax } from "@/components/motion/MotionRoot";
import { SPRING } from "@/components/motion/tokens";
import { LOOP_HREF, type LoopCounts, type NextAction } from "@/lib/next-action";
import { cn } from "@/lib/utils";
import { NextActionPill } from "./NextActionPill";
import { keyChips, LOOP_CHORDS } from "./shortcuts";
import type { LoopStageId } from "./loop-data";

const STAGES: readonly { id: LoopStageId; label: string; human: boolean }[] = [
  { id: "triage", label: "Triage", human: false },
  { id: "draft", label: "Draft", human: false },
  { id: "approve", label: "Approve", human: true },
  { id: "file", label: "File", human: false },
];

const NOUN: Record<LoopStageId, [string, string]> = {
  triage: ["item to triage", "items to triage"],
  draft: ["item ready for a letter", "items ready for a letter"],
  approve: ["waiting for your approval", "waiting for your approval"],
  file: ["approved report to file", "approved reports to file"],
};

/** Which stage the current page belongs to (for the moving underline). */
export function activeStage(pathname: string, view: string | null, filter: string | null): LoopStageId | null {
  if (pathname.startsWith("/approvals")) return "approve";
  if (pathname.startsWith("/reports")) return filter === "approved" || filter === null ? "file" : null;
  if (pathname.startsWith("/items")) return view === "draft-ready" ? "draft" : view === "needs-action" ? "triage" : null;
  return null;
}

interface LoopBarViewProps {
  counts: LoopCounts;
  running: number;
  next: NextAction;
  /** "shell": under the top bar (hidden on hero pages); "page": a hero page's own copy, below its hero. */
  placement?: "shell" | "page";
}

/** The Loop Bar strip (§5.1): TRIAGE n -> DRAFT n -> APPROVE n -> FILE n, then the next-action pill. */
export function LoopBarView({ counts, running, next, placement = "shell" }: LoopBarViewProps) {
  const { pathname, params } = useShellLocation();
  const current = activeStage(pathname, params.get("view"), params.get("filter"));
  const reduce = useReducedMotion();
  const noLedger = counts.triage === null && counts.draft === null && counts.file === null;
  // V4: on the dashboard the hero is the first thing under the top bar; the page draws its own strip below the hero.
  const inPage = placement === "page";
  if (!inPage && isHeroPage(pathname)) return null;

  return (
    <MotionMax>
    <nav
      aria-label="Core loop"
      data-testid="loop-bar"
      className={cn("glass mx-3 mt-3 flex h-11 items-center gap-3 rounded-full pr-1.5 pl-3 sm:mx-6 lg:mx-8 lg:mt-4", inPage && "mx-0 mt-0 sm:mx-0 lg:mx-0 lg:mt-0")}
    >
      {running > 0 ? (
        <Link href="/runs" className="flex shrink-0 items-center gap-2 rounded-full text-xs text-fg-2 hover:text-fg-1" data-testid="loop-running">
          <span aria-hidden className="glow-live size-2 rounded-full bg-blue-400" />
          <span className="sr-only">
            {running} agent {running === 1 ? "run" : "runs"} in progress
          </span>
        </Link>
      ) : null}
      <ol className="es-scroll-x flex min-w-0 flex-1 items-center gap-0.5" aria-label="Loop stages">
        {STAGES.map((s, i) => {
          const n = counts[s.id];
          const blocked = s.human && (n ?? 0) > 0;
          const active = current === s.id;
          const chord = keyChips(["g", LOOP_CHORDS[s.id]]).join(" ");
          const [one, many] = NOUN[s.id];
          const name = n === null ? `${s.label}: unknown` : `${s.label}: ${n} ${n === 1 ? one : many}`;
          return (
            <li key={s.id} className="flex shrink-0 items-center">
              {i > 0 ? <ChevronRight aria-hidden className="mx-0.5 size-3.5 text-fg-4" strokeWidth={1.5} /> : null}
              <Link
                href={LOOP_HREF[s.id]}
                aria-current={active ? "page" : undefined}
                aria-keyshortcuts={`G ${LOOP_CHORDS[s.id].toUpperCase()}`}
                title={`${name} (${chord})`}
                data-testid={`loop-stage-${s.id}`}
                className="relative inline-flex h-8 items-center gap-2 rounded-full px-2.5 transition-colors duration-150 hover:bg-fg-1/[0.06]"
              >
                <span className="instrument-label">{s.label}</span>
                <span
                  data-testid={`loop-count-${s.id}`}
                  className={cn("num text-[13px] font-semibold", n === null || n === 0 ? "text-fg-3" : blocked ? "text-pink-400" : "text-fg-1")}
                >
                  {n === null ? "—" : n}
                </span>
                <span className="sr-only">{n === null ? " unknown" : ` ${n === 1 ? one : many}`}</span>
                {active ? (
                  <m.span
                    aria-hidden
                    layoutId="loop-underline"
                    transition={reduce ? { duration: 0 } : SPRING.snappy}
                    className="absolute inset-x-2.5 -bottom-[3px] h-0.5 rounded-full bg-pink-500"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
        {noLedger ? <li className="shrink-0 pl-2 text-xs text-fg-3">Connect a ledger to start</li> : null}
      </ol>
      <div className="flex max-w-[55%] min-w-0 shrink justify-end">
        <NextActionPill action={next} />
      </div>
    </nav>
    </MotionMax>
  );
}
