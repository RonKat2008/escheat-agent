"use client";

import "./tour.css";
import { useEffect, useId, useRef } from "react";
import { Compass } from "lucide-react";
import { DISCLAIMER } from "@/lib/disclaimer";

interface WelcomeSheetProps {
  onTour: () => void;
  onSkip: () => void;
}

/**
 * First-visit welcome (lazy chunk, loaded by TourHost only when no choice is remembered). A non-blocking sheet docked
 * to the bottom corner (full width on phones): the page stays usable behind it. Either button, or Esc, is the answer
 * and it is never asked again. It does nothing to the product itself.
 */
export default function WelcomeSheet({ onTour, onSkip }: WelcomeSheetProps) {
  const id = useId();
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Only when nothing else (a dialog, the palette) is handling Escape.
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-testid="welcome-sheet"])')) return;
      onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <section role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="tour-welcome" data-testid="welcome-sheet">
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.08em] text-blue-300 uppercase">
        <Compass className="size-3.5" strokeWidth={1.75} aria-hidden />
        First time here
      </p>
      <h2 id={`${id}-t`} className="mt-1.5 text-[18px] leading-snug font-medium tracking-[-0.01em] text-balance text-fg-1">
        See how each part works
      </h2>
      <p id={`${id}-d`} className="mt-2 text-[13.5px] leading-[1.55] text-pretty text-fg-2">
        A short guided walk through the real screens, from what you owe to the filing. It only points at things; every approval stays your click.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button ref={primary} type="button" onClick={onTour} className="judge-tour-btn judge-tour-btn-primary" data-testid="welcome-tour">
          Take the 3-minute tour
        </button>
        <button type="button" onClick={onSkip} className="judge-tour-btn" data-testid="welcome-skip">
          Skip
        </button>
      </div>
      <p className="mt-3 text-[11.5px] text-fg-3">Replay it any time from the command menu or the Tour button.</p>
      <p className="mt-2 border-t border-line pt-2 text-[11px] text-fg-3" data-testid="welcome-disclaimer">
        {DISCLAIMER}
      </p>
    </section>
  );
}
