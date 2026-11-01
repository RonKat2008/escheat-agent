"use client";

import { useLayoutEffect, useRef, useState } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { addSeen, hasSeen } from "./seen";
import "./motion.css";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const CHANGE = { duration: 420, easing: EASE } as const;
const FIRST = { duration: 700, easing: EASE } as const;
const STORE_KEY = "es-countup-seen";

function firstTimeThisSession(key: string): boolean {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (hasSeen(raw, key)) return false;
    sessionStorage.setItem(STORE_KEY, addSeen(raw, key));
  } catch {
    /* storage unavailable: count up anyway */
  }
  return true;
}

export interface CountUpProps {
  value: number;
  /** Intl format for the digits (e.g. whole-dollar currency). */
  format?: Format;
  /** Exact text for assistive tech and text assertions; the animated digits are aria-hidden. */
  label: string;
  /** Stable id: count up from zero on the first view this session. Without it the number only tweens on change. */
  countUpKey?: string;
  /** Count up from zero every time this mounts (a result that just appeared), regardless of session. */
  countFromZero?: boolean;
  className?: string;
}

/**
 * A number that is final in the server HTML, counts up once per session (when countUpKey is set) and morphs on every
 * later change (a filter narrows a total). NumberFlow honours prefers-reduced-motion; the count-up is skipped too.
 */
export function CountUp({ value, format, label, countUpKey, countFromZero, className }: CountUpProps) {
  const [shown, setShown] = useState(value);
  const first = useRef(Boolean(countUpKey || countFromZero));
  /* eslint-disable react-hooks/set-state-in-effect -- the count-up must start from zero after hydration */
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced && value !== 0 && (countFromZero || (countUpKey && firstTimeThisSession(countUpKey)))) {
        setShown(0);
        const id = requestAnimationFrame(() => setShown(value));
        return () => cancelAnimationFrame(id);
      }
    }
    setShown(value);
  }, [value, countUpKey, countFromZero]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const timing = countUpKey || countFromZero ? FIRST : CHANGE;
  return (
    <span className={className}>
      <span className="sr-only">{label}</span>
      <NumberFlow aria-hidden value={shown} locales="en-US" format={format} transformTiming={timing} spinTiming={timing} opacityTiming={{ duration: 200 }} />
    </span>
  );
}
