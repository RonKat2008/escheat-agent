"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import "./motion.css";

const FLASH_MS = 1200;

/**
 * An identifier (hash, case id, realm id) in Geist Mono with a copy affordance. The whole chip is the button; the
 * icon swaps to a blue check and a polite live region says "Copied". Sits above row-wide links (relative z-10).
 */
export function CopyValue({
  value,
  display,
  label,
  wrap,
  className,
}: {
  value: string;
  /** Visible text when it differs from what is copied. */
  display?: string;
  /** What the value is, for the accessible name ("Copy payload hash 1a2b..."). */
  label: string;
  /** Let long text wrap instead of truncating. */
  wrap?: boolean;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), FLASH_MS);
    } catch {
      /* clipboard blocked (insecure context): the value stays selectable */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label} ${display ?? value}`}
      data-copied={done || undefined}
      className={cn(
        "group/copy relative z-10 -mx-1 inline-flex min-h-6 max-w-full items-center text-left gap-1.5 rounded-[5px] px-1 align-middle font-mono text-xs text-fg-2 transition-[background-color,color] duration-150 hover:bg-ink-3 hover:text-fg-1 active:scale-[0.97] data-copied:text-blue-300",
        className,
      )}
    >
      <span className={wrap ? "min-w-0 break-words" : "truncate"}>{display ?? value}</span>
      <span className="relative grid size-3 shrink-0 place-items-center" aria-hidden>
        <Copy
          className={cn("absolute size-3 opacity-0 transition-[opacity,transform] duration-150 group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100", done && "scale-75 !opacity-0")}
          strokeWidth={1.75}
        />
        <Check className={cn("absolute size-3 text-blue-400 transition-[opacity,transform] duration-150", done ? "opacity-100" : "scale-75 opacity-0")} strokeWidth={2.25} />
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}
