"use client";

import { useLayoutEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";

const TIMING = { duration: 700, easing: "cubic-bezier(0.16, 1, 0.3, 1)" } as const;
const FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/**
 * A percentage (0-1) that tweens up from zero once on mount (700ms, ease-out-expo; static under reduced motion).
 * The visible digits are NumberFlow; the exact text ("98.5%") is in the light DOM for readers and tests.
 */
export function EvalPercent({ value, testId, className }: { value: number; testId?: string; className?: string }) {
  const pctValue = Math.round(value * 1000) / 10;
  const [shown, setShown] = useState(pctValue);
  const first = useRef(true);
  /* eslint-disable react-hooks/set-state-in-effect -- tween must start from 0 after hydration */
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setShown(0);
        const id = requestAnimationFrame(() => setShown(pctValue));
        return () => cancelAnimationFrame(id);
      }
    }
    setShown(pctValue);
  }, [pctValue]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return (
    <span className={className}>
      <span data-testid={testId} className="sr-only">
        {pctValue.toFixed(1)}%
      </span>
      <NumberFlow aria-hidden value={shown} locales="en-US" format={FORMAT} suffix="%" transformTiming={TIMING} spinTiming={TIMING} opacityTiming={{ duration: 200 }} />
    </span>
  );
}
