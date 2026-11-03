"use client";

import { useId, type CSSProperties, type KeyboardEvent, type Ref, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Hand, X } from "lucide-react";
import { DISCLAIMER } from "@/lib/disclaimer";
import { cn } from "@/lib/utils";
import type { Side } from "./geometry";
import type { TourStep } from "./steps";
import type { AnchorPhase } from "./useTourAnchor";

interface TourPopoverProps {
  ref: Ref<HTMLDivElement>;
  primaryRef: RefObject<HTMLButtonElement | null>;
  step: TourStep;
  index: number;
  total: number;
  phase: AnchorPhase;
  readouts: { label: string; value: string }[];
  sheet: boolean;
  side: Side | "sheet";
  style?: CSSProperties;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  onJump: (i: number) => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab cycle inside the dialog. */
function trapTab(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The narration card: an anchored popover on wide screens, a bottom sheet on phones. Pure presentation. */
export function TourPopover({ ref, primaryRef, step, index, total, phase, readouts, sheet, side, style, onNext, onPrev, onClose, onJump }: TourPopoverProps) {
  const id = useId();
  const last = index === total - 1;
  const status = phase === "searching" ? "Opening this screen…" : phase === "missing" ? "This part is not on screen right now. The narration still applies; use Next to continue." : null;
  const live = `Stop ${index + 1} of ${total}: ${step.title}. ${step.narration}${step.human ? ` ${step.human}` : ""}`;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-narration`}
      onKeyDown={trapTab}
      data-testid="tour-popover"
      data-side={side}
      className={cn("judge-tour-pop", sheet ? "judge-tour-sheet" : "judge-tour-anchored")}
      style={style}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="tour-live">
        {live}
      </p>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.08em] text-blue-300 uppercase" data-testid="tour-counter">
            Judge tour · {pad2(index + 1)} / {pad2(total)}
          </p>
          <h2 id={`${id}-title`} className="mt-1 text-[17px] leading-snug font-medium tracking-[-0.01em] text-balance text-fg-1" data-testid="tour-title">
            {step.title}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the tour" className="judge-tour-icon-btn -mt-1 -mr-1" data-testid="tour-close">
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <p id={`${id}-narration`} className="mt-2 text-[13.5px] leading-[1.55] text-pretty text-fg-2" data-testid="tour-narration">
        {step.narration}
      </p>

      {readouts.length > 0 ? (
        <div className="mt-3 rounded-md border border-line bg-ink-1/80 px-3 py-2" data-testid="tour-readouts">
          <p className="font-mono text-[10.5px] tracking-[0.08em] text-fg-3 uppercase">On screen now</p>
          <dl className="mt-1 grid gap-1">
          {readouts.map((r) => (
            <div key={r.label} className="flex min-w-0 gap-2 text-[12.5px]">
              <dt className="shrink-0 text-fg-3">{r.label}</dt>
              <dd className="num min-w-0 break-words text-fg-1" data-testid="tour-readout">
                {r.value}
              </dd>
            </div>
          ))}
          </dl>
        </div>
      ) : null}

      {step.human ? (
        <p className="mt-3 flex gap-2 rounded-md border border-pink-700 bg-pink-950 px-3 py-2 text-[12.5px] leading-5 text-pink-300" data-testid="tour-human">
          <Hand className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{step.human}</span>
        </p>
      ) : null}

      {status ? (
        <p className="mt-3 text-xs text-fg-3" data-testid="tour-status">
          {status}
        </p>
      ) : null}

      <div className={cn("mt-4 flex items-center justify-between gap-3", sheet && "flex-wrap gap-y-2")}>
        <ol className={cn("flex items-center", sheet && "w-full justify-between")} aria-label="Tour stops">
          {Array.from({ length: total }, (_, i) => (
            <li key={i}>
              <button
                type="button"
                className="judge-tour-dot"
                aria-label={`Go to stop ${i + 1} of ${total}`}
                aria-current={i === index ? "step" : undefined}
                data-done={i < index ? "true" : "false"}
                onClick={() => onJump(i)}
                data-testid="tour-dot"
              />
            </li>
          ))}
        </ol>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onPrev} disabled={index === 0} className="judge-tour-btn" aria-label="Previous stop" data-testid="tour-prev">
            <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
          <button ref={primaryRef} type="button" onClick={onNext} className="judge-tour-btn judge-tour-btn-primary" data-testid="tour-next">
            {last ? "Finish" : "Next"}
            {last ? null : <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5">
        <p className="text-[11px] text-fg-3" data-testid="tour-disclaimer">
          {DISCLAIMER}
        </p>
        <p className="hidden text-[11px] text-fg-3 sm:block">
          <kbd className="judge-tour-kbd">←</kbd> <kbd className="judge-tour-kbd">→</kbd> move · <kbd className="judge-tour-kbd">Esc</kbd> close
        </p>
      </div>
    </div>
  );
}
