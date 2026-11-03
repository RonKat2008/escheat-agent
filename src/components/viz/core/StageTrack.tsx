import { CircleAlert, CircleCheck, CircleDashed, CircleDot, Circle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StageState = "done" | "active" | "waiting" | "human" | "idle" | "unknown";

export interface StageTrackStage {
  id: string;
  label: string;
  count?: number | null;
  state: StageState;
  href?: string;
}

export interface StageTrackProps {
  stages: StageTrackStage[];
  orientation?: "horizontal";
  size?: "sm" | "md";
  className?: string;
  "aria-label": string;
}

const ICON: Record<StageState, LucideIcon> = {
  done: CircleCheck,
  active: CircleDot,
  waiting: Circle,
  human: CircleAlert,
  idle: Circle,
  unknown: CircleDashed,
};

const STATE_WORD: Record<StageState, string> = {
  done: "done",
  active: "in progress",
  waiting: "waiting",
  human: "needs you",
  idle: "idle",
  unknown: "unknown",
};

const TONE: Record<StageState, string> = {
  done: "text-blue-400",
  active: "text-blue-300",
  waiting: "text-fg-2",
  human: "text-pink-400",
  idle: "text-fg-3",
  unknown: "text-fg-3",
};

function CountText({ count }: { count: number | null | undefined }) {
  if (count === undefined) return null;
  if (count === null) return <span className="num font-mono text-fg-3">{"—"}</span>;
  return <span className={cn("num font-mono", count === 0 ? "text-fg-3" : "text-fg-1")}>{count}</span>;
}

function Node({ stage, size }: { stage: StageTrackStage; size: "sm" | "md" }): ReactNode {
  const Icon = ICON[stage.state];
  const glow = stage.state === "human" ? "glow-human" : stage.state === "active" ? "glow-live" : "";
  const body = (
    <>
      <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-ink-1", glow, TONE[stage.state])}>
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className={stage.state === "unknown" ? "text-fg-4" : undefined} />
      </span>
      <span className={cn("flex flex-col leading-tight", size === "sm" ? "text-[12px]" : "text-[13px]")}>
        <span className={cn("whitespace-nowrap", stage.state === "human" ? "text-pink-400" : "text-fg-2")}>{stage.label}</span>
        <CountText count={stage.count} />
      </span>
      <span className="sr-only">{`, ${STATE_WORD[stage.state]}`}</span>
    </>
  );
  const cls = cn(
    "flex items-center gap-2 rounded-sm",
    size === "sm" ? "px-1 py-0.5" : "px-1.5 py-1",
    stage.href && "hover:bg-ink-3",
  );
  return stage.href ? (
    <Link href={stage.href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Generic stage nodes joined by rails. Status reads by shape and label first, color second. */
export function StageTrack({ stages, size = "md", className, "aria-label": ariaLabel }: StageTrackProps) {
  return (
    <ol aria-label={ariaLabel} className={cn("m-0 flex min-w-0 list-none flex-wrap items-center gap-y-2 p-0", className)}>
      {stages.map((s, i) => {
        const prev = stages[i - 1];
        const railLive = prev !== undefined && (prev.state === "done" || prev.state === "active");
        return (
          <li key={s.id} className="flex items-center">
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-1 block h-px w-6 shrink-0",
                  railLive ? "bg-blue-500" : "border-t border-dashed border-line-strong",
                )}
              />
            ) : null}
            <Node stage={s} size={size} />
          </li>
        );
      })}
    </ol>
  );
}
