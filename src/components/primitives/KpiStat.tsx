"use client";

import { useLayoutEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const TIMING = { duration: 400, easing: EASE } as const;
const HERO_TIMING = { duration: 700, easing: EASE } as const;
const SEEN_KEY = "es-countup-seen";

function seenThisSession(key: string): boolean {
  try {
    const seen = sessionStorage.getItem(SEEN_KEY)?.split(",") ?? [];
    if (seen.includes(key)) return true;
    sessionStorage.setItem(SEEN_KEY, [...seen, key].join(","));
  } catch {
    /* storage unavailable: just animate */
  }
  return false;
}

/**
 * Animated number. Server HTML shows the final value; on the client it counts up once per session
 * (countUp) and tweens on every later change. Cents render smaller and dimmer via ::part(fraction).
 */
export function AnimatedNumber({
  value,
  currency,
  className,
  countUp,
}: {
  /** cents when currency, else the plain number */
  value: number;
  currency?: boolean;
  className?: string;
  /** pass a stable key to count up from zero on the first view of this session */
  countUp?: boolean | string;
}) {
  const [shown, setShown] = useState(value);
  const first = useRef(Boolean(countUp));
  /* eslint-disable react-hooks/set-state-in-effect -- count-up must start from 0 after hydration */
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      const key = typeof countUp === "string" ? countUp : "default";
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !seenThisSession(key)) {
        setShown(0);
        const id = requestAnimationFrame(() => setShown(value));
        return () => cancelAnimationFrame(id);
      }
    }
    setShown(value);
  }, [value, countUp]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const n = currency ? shown / 100 : shown;
  return (
    <span className={cn("inline-block", currency && "money-flow", className)}>
      <span className="sr-only">{currency ? formatUSD(value) : value.toLocaleString("en-US")}</span>
      <NumberFlow
        aria-hidden
        value={n}
        locales="en-US"
        format={currency ? { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined}
        transformTiming={countUp ? HERO_TIMING : TIMING}
        spinTiming={countUp ? HERO_TIMING : TIMING}
        opacityTiming={{ duration: 200 }}
      />
    </span>
  );
}

/** A labelled figure. Proportional face, tabular figures, sentence-case label. No tiles. */
export function KpiStat({
  label,
  value,
  currency,
  hint,
  size = "md",
  countUp,
  className,
}: {
  label: string;
  value: number;
  currency?: boolean;
  hint?: React.ReactNode;
  size?: "md" | "lg" | "hero";
  countUp?: boolean | string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 text-[13px] text-fg-2">{label}</div>
      <div
        className={cn(
          "num leading-none font-medium text-fg-1",
          size === "hero" && "text-[clamp(2.75rem,1.6rem+3.6vw,4.5rem)] tracking-[-0.04em]",
          size === "lg" && "text-[28px] tracking-[-0.02em]",
          size === "md" && "text-xl tracking-[-0.015em]",
        )}
      >
        <AnimatedNumber value={value} currency={currency} countUp={countUp} />
      </div>
      {hint ? <div className="mt-2 text-sm text-fg-2">{hint}</div> : null}
    </div>
  );
}
