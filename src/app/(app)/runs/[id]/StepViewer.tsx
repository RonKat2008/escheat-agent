"use client";

import { ChevronRight, ImageOff, Maximize2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, Kbd } from "@/components/primitives";
import { JsonView } from "@/components/b/JsonView";
import { formatDuration, type TraceStepView } from "@/components/b/trace";
import { cn } from "@/lib/utils";
import { absoluteTime, formatOffset } from "../run-meta";
import { ShotLightbox, type Shot } from "./ShotLightbox";
import { kindMeta } from "./step-kinds";
import { currentStepIndex, stepSpans } from "./trace-view";

const hasPayload = (d: unknown) => d != null && !(typeof d === "object" && Object.keys(d as object).length === 0);

function Thumb({ shot, onOpen }: { shot: Shot; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="inline-flex h-[72px] w-[115px] items-center justify-center gap-1.5 rounded-[6px] border border-line text-[11px] text-fg-3">
        <ImageOff className="size-3.5" strokeWidth={1.5} aria-hidden /> Not stored
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open screenshot from step ${shot.step + 1}`}
      className="group/thumb relative block h-[72px] w-[115px] overflow-hidden rounded-[6px] border border-line bg-ink-2 transition-[border-color] duration-150 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
      <img src={shot.src} alt="" width={115} height={72} loading="lazy" decoding="async" className="size-full object-cover object-top" onError={() => setBroken(true)} />
      <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100">
        <Maximize2 className="size-4 text-fg-1" strokeWidth={1.5} aria-hidden />
      </span>
    </button>
  );
}

interface StepViewerProps {
  runId: string;
  steps: TraceStepView[];
  /** ISO start of the run, for "+0.4s" offsets */
  startedAt: string;
  /** ISO end of the shared time axis: the run's finish, or the server's "now" while it is live. */
  endAt: string;
  live?: boolean;
}

const GATE_KINDS = new Set(["paused", "approval"]);

/** A screenshot filmstrip across the top of the trace: every frame the agent captured, in order. */
function Filmstrip({ shots, onOpen }: { shots: Shot[]; onOpen: (i: number) => void }) {
  if (shots.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="instrument-label mb-2">Filmstrip · {shots.length} {shots.length === 1 ? "frame" : "frames"}</p>
      <div className="-mx-1 overflow-x-auto px-1 pb-1" tabIndex={0} role="region" aria-label="Screenshots from this run, scrolls horizontally" data-testid="run-filmstrip">
        <ol className="flex gap-2">
          {shots.map((shot, i) => (
            <li key={shot.step} className="shrink-0">
              <Thumb shot={shot} onOpen={() => onOpen(i)} />
              <p className="mt-1 w-[115px] truncate text-[11px] text-fg-3" title={shot.label}>
                <span className="num">{shot.step + 1}</span> · {shot.label}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Where this step sat in the run: a bar on the shared time axis (the mini Gantt column). */
function SpanBar({ left, width, kind }: { left: number; width: number; kind: string }) {
  const tint = kind === "error" || GATE_KINDS.has(kind) ? "bg-pink-500" : kind === "done" || kind === "result" ? "bg-blue-300" : "bg-blue-500";
  return (
    <span aria-hidden className="relative hidden h-1.5 w-24 shrink-0 self-center overflow-hidden rounded-full bg-ink-3 md:block">
      <span className={cn("absolute inset-y-0 rounded-full", tint)} style={{ left: `${left * 100}%`, width: `max(2px, ${width * 100}%)` }} />
    </span>
  );
}

export function StepViewer({ runId, steps, startedAt, endAt, live }: StepViewerProps) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(steps.filter((s) => s.tone === "error" && s.kind !== "guard_blocked").map((s) => s.index)));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [shotAt, setShotAt] = useState<number | null>(null);

  const start = Date.parse(startedAt);
  const spans = useMemo(() => stepSpans(steps, Date.parse(startedAt), Date.parse(endAt)), [steps, startedAt, endAt]);
  const current = live ? currentStepIndex(steps) : null;
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of steps) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
    return [...m.entries()];
  }, [steps]);
  const shots: Shot[] = useMemo(
    () => steps.filter((s) => s.screenshot).map((s) => ({ step: s.index, kind: s.kind, label: s.label, src: `/runs/${runId}/shots/${s.index}` })),
    [steps, runId],
  );

  if (steps.length === 0) {
    return <EmptyState title="No steps recorded" description="This run did not record a trace. The input and output below are everything it stored." />;
  }

  const visible = steps.filter((s) => !hidden.has(s.kind));
  const expandable = visible.filter((s) => hasPayload(s.data));
  const allOpen = expandable.length > 0 && expandable.every((s) => open.has(s.index));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleKind = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const onKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const down = e.key === "ArrowDown" || e.key === "j";
    const up = e.key === "ArrowUp" || e.key === "k";
    if (!down && !up) return;
    const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-step-btn]")];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = btns[Math.max(0, Math.min(btns.length - 1, at < 0 ? 0 : at + (down ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div>
      <Filmstrip shots={shots} onOpen={setShotAt} />
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show step kinds">
          {kinds.map(([k, n]) => {
            const m = kindMeta(k);
            const on = !hidden.has(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2 text-xs transition-[background-color,border-color,color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 max-sm:h-8",
                  on ? "border-line-hover bg-ink-2 text-fg-1" : "border-line text-fg-3 hover:text-fg-2",
                )}
              >
                <m.icon className={cn("size-3.5", on ? m.tint : "text-fg-3")} strokeWidth={1.5} aria-hidden />
                {m.label}
                <span className="num text-fg-3">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1 text-xs text-fg-3 lg:inline-flex">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span className="ml-0.5">move</span>
          </span>
          {expandable.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(expandable.map((s) => s.index)))}
              className="h-7 rounded-[6px] px-2 text-xs text-fg-2 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="border-t border-line py-6 text-sm text-fg-2">All step kinds are hidden. Turn one back on above.</p>
      ) : null}

      <ol className="relative border-t border-line" onKeyDown={onKey} aria-label="Trace steps" data-testid="trace-steps">
        {visible.map((s, vi) => {
          const m = kindMeta(s.kind);
          const at = s.at ? Date.parse(s.at) : NaN;
          const offset = Number.isFinite(at) && Number.isFinite(start) ? formatOffset(at - start) : null;
          const canOpen = hasPayload(s.data);
          const isOpen = canOpen && open.has(s.index);
          const shotIdx = s.screenshot ? shots.findIndex((x) => x.step === s.index) : -1;
          const failed = s.kind === "error";
          const header = (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className={cn("w-[104px] shrink-0 text-xs", failed ? "text-pink-400" : "text-fg-3")}>{m.label}</span>
                <span className={cn("min-w-0 text-[13px] leading-5 break-words", m.quiet ? "text-fg-2 max-sm:truncate" : "text-fg-1")}>{s.label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3 pl-2 text-xs">
                {spans.has(s.index) ? <SpanBar {...spans.get(s.index)!} kind={s.kind} /> : spans.size ? <span aria-hidden className="hidden w-24 md:block" /> : null}
                {s.durationMs != null ? <span className="num hidden w-14 text-right text-fg-3 sm:inline">{formatDuration(s.durationMs)}</span> : null}
                {offset ? (
                  <time dateTime={s.at!} title={absoluteTime(new Date(at))} className="num w-14 text-right text-fg-2">
                    {offset}
                  </time>
                ) : (
                  <span className="w-14 text-right text-fg-3">—</span>
                )}
                {canOpen ? (
                  <ChevronRight className={cn("size-3.5 self-center text-fg-3 transition-transform duration-200 ease-[var(--ease-out)]", isOpen && "rotate-90")} strokeWidth={1.5} aria-hidden />
                ) : (
                  <span className="w-3.5" aria-hidden />
                )}
              </span>
            </>
          );
          return (
            <li
              key={s.index}
              className={cn(
                "relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 sm:gap-x-3",
                live && vi >= visible.length - 3 && "es-rise",
              )}
              style={live ? { ["--i" as string]: 0 } : undefined}
            >
              <span aria-hidden className={cn("absolute top-0 bottom-0 left-[13.5px] w-px bg-line-hover", vi === 0 && "top-4", vi === visible.length - 1 && "bottom-auto h-4")} />
              <span
                aria-hidden
                data-gate={GATE_KINDS.has(s.kind) ? "" : undefined}
                className={cn(
                  "relative z-[1] mt-2.5 grid size-7 place-items-center rounded-full bg-ink-0 ring-1 ring-inset",
                  m.ring,
                  GATE_KINDS.has(s.kind) && "bg-pink-950 ring-pink-500",
                  s.index === current && (GATE_KINDS.has(s.kind) ? "glow-human es-pulse" : "glow-live es-pulse"),
                )}
              >
                <m.icon className={cn("size-3.5", m.tint)} strokeWidth={1.75} />
              </span>
              <div className={cn("min-w-0 border-b border-line py-1.5", vi === visible.length - 1 && "border-b-0")}>
                {canOpen ? (
                  <button
                    type="button"
                    data-step-btn
                    aria-expanded={isOpen}
                    onClick={() => toggle(s.index)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-start rounded-[6px] px-2 py-1.5 text-left transition-colors duration-100 hover:bg-ink-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400"
                  >
                    <span className="sr-only">Step {s.index + 1}: </span>
                    {header}
                  </button>
                ) : (
                  <div className="flex items-start py-1.5">
                    <span className="sr-only">Step {s.index + 1}: </span>
                    {header}
                  </div>
                )}
                {shotIdx >= 0 ? (
                  <div className="pb-2 sm:pl-[116px]">
                    <Thumb shot={shots[shotIdx]!} onOpen={() => setShotAt(shotIdx)} />
                  </div>
                ) : null}
                {isOpen ? (
                  <div className="es-rise pt-1 pb-3 sm:pl-[116px]">
                    <JsonView label={s.kind === "tool_call" ? "Tool input" : s.kind === "result" ? "Output" : "Payload"} value={s.data} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <ShotLightbox shots={shots} index={shotAt} onIndex={setShotAt} onClose={() => setShotAt(null)} />
    </div>
  );
}
