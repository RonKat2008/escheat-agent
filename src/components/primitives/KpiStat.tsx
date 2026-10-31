"use client";

import { useLayoutEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

const TIMING = { duration: 400, easing: "cubic-bezier(.22,1,.36,1)" } as const;
const HERO_TIMING = { duration: 700, easing: "cubic-bezier(.22,1,.36,1)" } as const;

/** Animated number. Server HTML shows the final value; client counts up once on first load. */
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
  countUp?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const first = useRef(Boolean(countUp));
  /* eslint-disable react-hooks/set-state-in-effect -- count-up must start from 0 after hydration */
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setShown(0);
        const id = requestAnimationFrame(() => setShown(value));
        return () => cancelAnimationFrame(id);
      }
    }
    setShown(value);
  }, [value]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const dollars = (currency ? shown / 100 : shown);
  return (
    <span className={cn("inline-block", className)}>
      <span className="sr-only">{currency ? formatUSD(value) : value.toLocaleString("en-US")}</span>
      <NumberFlow
        aria-hidden
        value={dollars}
        locales="en-US"
        format={currency ? { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined}
        transformTiming={countUp ? HERO_TIMING : TIMING}
        spinTiming={countUp ? HERO_TIMING : TIMING}
        opacityTiming={{ duration: 200 }}
      />
    </span>
  );
}

/** Big mono number with a small label above. */
export function KpiStat({
  label,
  value,
  currency,
  hint,
  tone = "default",
  size = "md",
  countUp,
  className,
}: {
  label: string;
  value: number;
  currency?: boolean;
  hint?: React.ReactNode;
  tone?: "default" | "amber" | "green" | "gradient";
  size?: "md" | "lg" | "hero";
  countUp?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 text-[11px] leading-4 font-medium tracking-[0.06em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono leading-none font-semibold tabular-nums",
          size === "hero" && "text-[clamp(2.5rem,1.4rem+4.2vw,4.25rem)] tracking-[-0.02em]",
          size === "lg" && "text-4xl",
          size === "md" && "text-2xl",
          tone === "amber" && "text-at-risk",
          tone === "gradient" && "text-foreground [text-shadow:0_0_48px_var(--es-bolt-glow),0_0_90px_var(--es-pink-glow)]",
          tone === "green" && "text-resolved",
        )}
      >
        <AnimatedNumber value={value} currency={currency} countUp={countUp} />
      </div>
      {hint ? <div className="mt-2 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
